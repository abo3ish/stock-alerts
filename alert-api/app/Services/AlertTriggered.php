<?php

namespace App\Services;

use App\Models\Alert;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Applies an alert-triggered event from the Evaluation Engine. Laravel owns the alerts table,
 * so the engine announces the trigger and this is the only place that records it.
 */
final class AlertTriggered
{
    /**
     * Returns false for a duplicate or an alert that no longer exists. Delivery is at-least-once,
     * so duplicates are normal: the conditional UPDATE makes them a no-op (no inbox table needed).
     */
    public static function handle(array $event): bool
    {
        return DB::transaction(function () use ($event) {
            $updated = Alert::whereKey($event['alert_id'])
                ->where('status', 'active')
                ->update([
                    'status' => 'triggered',
                    'triggered_at' => Carbon::createFromTimestampMs($event['triggered_at']),
                ]);

            if ($updated === 0) {
                return false;
            }

            // The engine already removed it from Redis; the outbox makes that certain (and repairs a re-add by the relay).
            AlertCache::enqueue(Alert::find($event['alert_id']));

            return true;
        });
    }
}
