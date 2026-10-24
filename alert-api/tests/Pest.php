<?php

use App\Services\AlertCache;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->beforeEach(function () {
        // Guard: flushdb must only ever hit the test Redis DB, never dev data in DB 0.
        expect((string) config('database.redis.default.database'))->toBe('1');
        Redis::flushdb();
    })
    ->in('Feature');

const ALERT = ['user_id' => 1, 'symbol' => 'AAPL', 'condition' => 'above', 'target_price' => 200];

function createAlert(array $overrides = []): int
{
    return test()->postJson('/api/alerts', [...ALERT, ...$overrides])->assertCreated()->json('id');
}

/**
 * The cached alerts of a symbol (from the data hash). Also checks the index on every call: each alert must sit
 * in exactly the sorted set of its condition, scored by its target price, and no set may hold an id without data.
 */
function cachedAlerts(string $symbol = 'AAPL'): array
{
    $data = array_map(fn ($json) => json_decode($json, true), Redis::hgetall(AlertCache::dataKey($symbol)));

    $indexed = [];
    foreach (['above', 'below'] as $condition) {
        foreach (Redis::zrange(AlertCache::setKey($condition, $symbol), 0, -1, true) as $id => $score) {
            expect($indexed)->not->toHaveKey($id); // in both sets = a condition change left a stale entry
            $indexed[$id] = ['condition' => $condition, 'target_price' => (float) $score];
        }
    }
    $expected = array_map(fn ($alert) => ['condition' => $alert['condition'], 'target_price' => (float) $alert['target_price']], $data);
    expect($indexed)->toEqual($expected);

    return $data;
}
