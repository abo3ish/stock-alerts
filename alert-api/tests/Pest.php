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

function cachedAlerts(string $symbol = 'AAPL'): array
{
    return array_map(fn ($json) => json_decode($json, true), Redis::hgetall(AlertCache::key($symbol)));
}
