<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * ~1M active alerts, skewed like a real market: a few hot symbols hold a big share.
 * One INSERT ... SELECT generate_series, so Postgres builds the rows itself (seconds, not minutes of PHP loops).
 * Bypasses the outbox on purpose: run alerts:rebuild-cache afterwards to load Redis.
 * Seeded users are >= 1,000,000, so they can be told apart from hand-made alerts.
 */
class LoadTestSeeder extends Seeder
{
    private const HOT = [
        'AAPL' => 100_000, 'TSLA' => 50_000,
        'MSFT' => 20_000, 'NVDA' => 20_000, 'AMZN' => 20_000, 'GOOGL' => 20_000, 'META' => 20_000,
    ];

    private const PER_OTHER_SYMBOL = 150; // SYM0007..SYM4999, the simulator's names

    public function run(): void
    {
        $hot = collect(self::HOT)->map(fn ($n, $symbol) => "('{$symbol}', {$n})")->implode(', ');
        $perOther = self::PER_OTHER_SYMBOL;

        // Targets far outside the simulator's prices, so nothing fires: every tick pays the full scan (worst case).
        DB::statement(<<<SQL
            INSERT INTO alerts (user_id, symbol, condition, target_price, status, created_at, updated_at)
            SELECT 1000000 + (random() * 5000000)::int,
                   s.symbol,
                   CASE WHEN g % 2 = 0 THEN 'above' ELSE 'below' END,
                   CASE WHEN g % 2 = 0 THEN round((100000 + random() * 100000)::numeric, 2) ELSE 0 END,
                   'active', now(), now()
            FROM (
                VALUES {$hot}
                UNION ALL
                SELECT 'SYM' || lpad(i::text, 4, '0'), {$perOther} FROM generate_series(7, 4999) AS i
            ) AS s(symbol, n)
            CROSS JOIN LATERAL generate_series(1, s.n) AS g
        SQL);
    }
}
