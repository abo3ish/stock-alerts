<?php

namespace App\Services;

use App\Models\Alert;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

/**
 * The Redis side of the dual write. This key layout is a contract with the Node engine:
 *
 *   alerts:{SYMBOL}  (hash)   field = alert id   value = {"user_id", "target_price", "condition"}
 */
final class AlertCache
{
    public static function key(string $symbol): string
    {
        return "alerts:{$symbol}";
    }

    /** Record "this alert changed". Call inside the same DB transaction as the change. */
    public static function enqueue(Alert $alert): void
    {
        DB::table('alert_outbox')->insert(['alert_id' => $alert->id, 'symbol' => $alert->symbol]);
    }

    /**
     * Apply pending outbox rows to Redis. Returns how many were applied.
     * Each row syncs the alert's *current* DB state (not the change itself), so replaying
     * a row twice or out of order still ends correct: HSET/HDEL are idempotent.
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

            Redis::pipeline(function ($pipe) use ($rows, $alerts) {
                foreach ($rows as $row) {
                    $alert = $alerts->get($row->alert_id);
                    $alert?->status === 'active'
                        ? $pipe->hset(self::key($row->symbol), (string) $row->alert_id, self::payload($alert))
                        : $pipe->hdel(self::key($row->symbol), (string) $row->alert_id);
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
            Redis::pipeline(function ($pipe) use ($alerts) {
                foreach ($alerts as $alert) {
                    $pipe->hset(self::key($alert->symbol), (string) $alert->id, self::payload($alert));
                }
            });
            $count += $alerts->count();
        });

        return $count;
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
