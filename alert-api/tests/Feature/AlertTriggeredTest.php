<?php

// Applying alert-triggered events from the engine (at-least-once delivery).

use App\Models\Alert;
use App\Services\AlertCache;
use App\Services\AlertTriggered;

function triggeredEvent(int $id, int $triggeredAtMs = 1_792_000_000_000): array
{
    return ['alert_id' => $id, 'user_id' => 1, 'symbol' => 'AAPL', 'price' => 250, 'triggered_at' => $triggeredAtMs];
}

it('marks an active alert triggered and removes it from the cache', function () {
    $id = createAlert();
    AlertCache::relay();

    expect(AlertTriggered::handle(triggeredEvent($id)))->toBeTrue();

    $alert = Alert::find($id);
    expect($alert->status)->toBe('triggered')
        ->and($alert->triggered_at->getTimestampMs())->toBe(1_792_000_000_000);

    AlertCache::relay();
    expect(cachedAlerts())->toBe([]);
});

it('ignores a duplicate event', function () {
    $id = createAlert();
    AlertTriggered::handle(triggeredEvent($id, 1_792_000_000_000));

    expect(AlertTriggered::handle(triggeredEvent($id, 1_792_000_999_000)))->toBeFalse()
        ->and(Alert::find($id)->triggered_at->getTimestampMs())->toBe(1_792_000_000_000); // first one wins
});

it('ignores an event for a deleted alert', function () {
    $id = createAlert();
    $this->deleteJson("/api/alerts/{$id}")->assertNoContent();

    expect(AlertTriggered::handle(triggeredEvent($id)))->toBeFalse();
});

it('keeps a triggered alert out of a cache rebuild', function () {
    $id = createAlert();
    AlertTriggered::handle(triggeredEvent($id));

    expect(AlertCache::rebuild())->toBe(0)
        ->and(cachedAlerts())->toBe([]);
});
