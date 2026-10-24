<?php

namespace App\Services;

use App\Models\Alert;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

/**
 * The Redis side of the outbox. This key layout is a contract with the Node engine (engine/src/alerts.ts):
 *
 *   alerts:above:{SYMBOL}  (sorted set)  member = alert id   score = target price   ("fire when price >= score")
 *   alerts:below:{SYMBOL}  (sorted set)  member = alert id   score = target price   ("fire when price <= score")
 *   alerts:data:{SYMBOL}   (hash)        field  = alert id   value = {"user_id", "target_price", "condition"}
 *
 * The sorted sets let the engine ask Redis for only the alerts a price satisfies (ZRANGEBYSCORE),
 * instead of loading every alert of the symbol. The hash holds the details for the few that match.
 *
 * Writes are pipelined (one round trip per batch) and ordered so a concurrent reader is always safe:
 * data before index on put, index before data on remove. Not MULTI: phpredis sends every queued command
 * in its own round trip, which made a 1M-alert rebuild take ~15 minutes instead of ~25 seconds.
 */
final class AlertCache
{
    public static function setKey(string $condition, string $symbol): string
    {
        return "alerts:{$condition}:{$symbol}";
    }

    public static function dataKey(string $symbol): string
    {
        return "alerts:data:{$symbol}";
    }

    /** Record "this alert changed". Call inside the same DB transaction as the change. */
    public static function enqueue(Alert $alert): void
    {
        DB::table('alert_outbox')->insert(['alert_id' => $alert->id, 'symbol' => $alert->symbol]);
    }

    /**
     * Apply pending outbox rows to Redis. Returns how many were applied.
     * Each row syncs the alert's *current* DB state (not the change itself), so replaying
     * a row twice or out of order still ends correct: ZADD/ZREM/HSET/HDEL are idempotent.
     * If Redis throws, the transaction rolls back and the rows stay for the next try.
     * ponytail: assumes one relay process; two relays can race on the same alert. Partition by alert_id if you scale it.
     */
    public static function relay(int $limit = 500): int
    {
        return DB::transaction(function () use ($limit) {
            $rows = DB::table('alert_outbox')->orderBy('id')->limit($limit)->lock('for update skip locked')->get();
            if ($rows->isEmpty()) {
                return 0;
            }

            $alerts = Alert::whereIn('id', $rows->pluck('alert_id'))->get()->keyBy('id');

            Redis::pipeline(function ($redis) use ($rows, $alerts) {
                foreach ($rows as $row) {
                    $alert = $alerts->get($row->alert_id);
                    $alert?->status === 'active'
                        ? self::put($redis, $alert)
                        : self::remove($redis, $row->symbol, (string) $row->alert_id);
                }
            });

            DB::table('alert_outbox')->whereIn('id', $rows->pluck('id'))->delete();

            return $rows->count();
        });
    }

    /**
     * Reload every active alert from Postgres (the source of truth).
     * ponytail: fill-only, so entries deleted from the DB stay in Redis; meant for an empty cache after a crash.
     * Rebuilding a live cache needs build-into-temp-keys + RENAME.
     */
    public static function rebuild(): int
    {
        $count = 0;

        Alert::where('status', 'active')->chunkById(5000, function ($alerts) use (&$count) {
            Redis::pipeline(function ($redis) use ($alerts) {
                foreach ($alerts as $alert) {
                    self::put($redis, $alert);
                }
            });
            $count += $alerts->count();
        });

        return $count;
    }

    // Data first, then add to the right set, then leave the other one (only matters on an above <-> below change).
    // The alert is never missing from the index; for an instant it can sit in both sets, which is harmless:
    // the engine re-checks every candidate against the data's current condition (triggeredBy).
    private static function put($redis, Alert $alert): void
    {
        $id = (string) $alert->id;
        $other = $alert->condition === 'above' ? 'below' : 'above';
        $redis->hSet(self::dataKey($alert->symbol), $id, self::payload($alert));
        $redis->zAdd(self::setKey($alert->condition, $alert->symbol), (float) $alert->target_price, $id);
        $redis->zRem(self::setKey($other, $alert->symbol), $id);
    }

    // Index first, then data: a reader may find data without an index entry (unused), never the reverse.
    private static function remove($redis, string $symbol, string $id): void
    {
        $redis->zRem(self::setKey('above', $symbol), $id);
        $redis->zRem(self::setKey('below', $symbol), $id);
        $redis->hDel(self::dataKey($symbol), $id);
    }

    private static function payload(Alert $alert): string
    {
        return json_encode([
            'user_id' => $alert->user_id,
            'target_price' => (float) $alert->target_price,
            'condition' => $alert->condition,
        ]);
    }
}
