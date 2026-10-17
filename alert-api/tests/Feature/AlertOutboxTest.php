<?php

// The guarantees the outbox design rests on, checked against real Postgres + Redis.

use App\Models\Alert;
use App\Services\AlertCache;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;

function setRedisPort(int|string $port): void
{
    config(['database.redis.default.port' => $port]);
    // RedisManager copies its config when built, so rebuild it rather than just purging the connection.
    app()->forgetInstance('redis');
    Redis::clearResolvedInstance('redis');
}

describe('write side: the request only touches Postgres', function () {
    it('writes the alert and an outbox row, but not Redis', function () {
        $id = createAlert();

        $this->assertDatabaseHas('alerts', ['id' => $id, 'status' => 'active']);
        $this->assertDatabaseHas('alert_outbox', ['alert_id' => $id, 'symbol' => 'AAPL']);
        expect(cachedAlerts())->toBe([]);
    });

    it('does not save the alert when the outbox write fails', function () {
        Schema::drop('alert_outbox'); // make the second insert of the transaction fail

        $this->postJson('/api/alerts', ALERT)->assertServerError();

        $this->assertDatabaseCount('alerts', 0);
    });

    it('writes nothing for invalid input', function () {
        $this->postJson('/api/alerts', ['user_id' => 1, 'symbol' => 'aapl', 'condition' => 'near', 'target_price' => -5])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['symbol', 'condition', 'target_price']);

        $this->assertDatabaseCount('alerts', 0);
        $this->assertDatabaseCount('alert_outbox', 0);
    });

    it('does not let an update change the symbol', function () {
        $id = createAlert();

        $this->patchJson("/api/alerts/{$id}", ['symbol' => 'TSLA', 'target_price' => 210])->assertOk();

        $this->assertDatabaseHas('alerts', ['id' => $id, 'symbol' => 'AAPL', 'target_price' => 210]);
    });
});

describe('relay', function () {
    it('syncs a created alert and clears the outbox', function () {
        $id = createAlert();

        expect(AlertCache::relay())->toBe(1)
            ->and(cachedAlerts())->toEqual([$id => ['user_id' => 1, 'target_price' => 200, 'condition' => 'above']]);
        $this->assertDatabaseCount('alert_outbox', 0);
    });

    it('writes the current state, not each change', function () {
        $id = createAlert();
        $this->patchJson("/api/alerts/{$id}", ['target_price' => 240])->assertOk();

        expect(AlertCache::relay())->toBe(2)
            ->and(cachedAlerts()[$id]['target_price'])->toEqual(240);
    });

    it('removes a deleted alert', function () {
        $id = createAlert();
        AlertCache::relay();

        $this->deleteJson("/api/alerts/{$id}")->assertNoContent();
        AlertCache::relay();

        expect(cachedAlerts())->toBe([]);
    });

    it('removes a triggered alert', function () {
        $id = createAlert();
        AlertCache::relay();

        $alert = Alert::find($id);
        $alert->forceFill(['status' => 'triggered'])->save();
        AlertCache::enqueue($alert);
        AlertCache::relay();

        expect(cachedAlerts())->toBe([]);
    });

    it('gives the same result when a row is replayed', function () {
        $id = createAlert();
        AlertCache::relay();
        $before = cachedAlerts();

        AlertCache::enqueue(Alert::find($id)); // as if the relay crashed after Redis, before deleting the row
        AlertCache::relay();

        expect(cachedAlerts())->toBe($before);
    });

    it('loses nothing while Redis is down', function () {
        $port = config('database.redis.default.port');
        setRedisPort(1); // nothing listens there

        $id = createAlert(); // the API does not notice

        expect(fn() => AlertCache::relay())->toThrow(RedisException::class);
        $this->assertDatabaseHas('alert_outbox', ['alert_id' => $id]); // rolled back, still pending

        setRedisPort($port);
        expect(AlertCache::relay())->toBe(1)
            ->and(cachedAlerts())->toHaveKey($id);
    });
});

describe('rebuild', function () {
    it('restores only active alerts', function () {
        $active = createAlert();
        $other = createAlert(['symbol' => 'TSLA']);
        Alert::find(createAlert())->forceFill(['status' => 'triggered'])->save();
        // Never relayed: Redis is empty, as after a crash.

        expect(AlertCache::rebuild())->toBe(2)
            ->and(array_keys(cachedAlerts()))->toBe([$active])
            ->and(array_keys(cachedAlerts('TSLA')))->toBe([$other]);
    });
});
