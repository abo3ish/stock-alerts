<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ~1M active alerts, skewed like a real market: a few hot symbols hold a big share.
 * Symbol names come from shared/symbols.json, the same file the engine's price simulator reads,
 * so every seeded symbol gets ticks and every ticked symbol has alerts.
 * One INSERT ... SELECT, so Postgres builds the rows itself (seconds, not minutes of PHP loops).
 * Bypasses the outbox on purpose: run alerts:rebuild-cache afterwards to load Redis.
 * Seeded users are >= 1,000,000, so they can be told apart from hand-made alerts.
 */
class LoadTestSeeder extends Seeder
{
    private const HOT = [
        'AAPL' => 100_000, 'TSLA' => 50_000,
        'MSFT' => 20_000, 'NVDA' => 20_000, 'AMZN' => 20_000, 'GOOGL' => 20_000, 'META' => 20_000,
    ];

    private const PER_OTHER_SYMBOL = 150;

    // Repo root, outside alert-api: run this seeder from the host, not the worker containers (they mount alert-api only).
    private const SYMBOLS_FILE = '../shared/symbols.json';

    public function run(): void
    {
        $symbols = json_decode(file_get_contents(base_path(self::SYMBOLS_FILE)), true, flags: JSON_THROW_ON_ERROR);

        $missing = array_diff(array_keys(self::HOT), $symbols);
        if ($missing !== []) {
            throw new RuntimeException('Hot symbols missing from shared/symbols.json: '.implode(', ', $missing));
        }

        $counts = array_map(fn (string $symbol) => self::HOT[$symbol] ?? self::PER_OTHER_SYMBOL, $symbols);

        // Targets far outside the simulator's prices, so nothing fires: every tick pays the full scan (worst case).
        // unnest(names, counts) turns the two arrays into (symbol, n) rows; generate_series repeats each n times.
        DB::statement(<<<'SQL'
            INSERT INTO alerts (user_id, symbol, condition, target_price, status, created_at, updated_at)
            SELECT 1000000 + (random() * 5000000)::int,
                   s.symbol,
                   CASE WHEN g % 2 = 0 THEN 'above' ELSE 'below' END,
                   CASE WHEN g % 2 = 0 THEN round((100000 + random() * 100000)::numeric, 2) ELSE 0 END,
                   'active', now(), now()
            FROM unnest(?::text[], ?::int[]) AS s(symbol, n)
            CROSS JOIN LATERAL generate_series(1, s.n) AS g
        SQL, ['{'.implode(',', $symbols).'}', '{'.implode(',', $counts).'}']);
    }
}
