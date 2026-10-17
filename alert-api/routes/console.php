<?php

use App\Services\AlertCache;
use Illuminate\Support\Facades\Artisan;

// Ctrl+C is safe: a killed batch rolls back and its rows are retried.
// ponytail: polls every 200ms when idle; Postgres LISTEN/NOTIFY or CDC (Debezium) when that latency matters.
Artisan::command('alerts:relay', function () {
    $this->info('Relaying alert_outbox -> Redis. Ctrl+C to stop.');
    while (true) {
        try {
            $applied = AlertCache::relay();
            if ($applied > 0) {
                $this->line("applied {$applied}");
            } else {
                usleep(200_000);
            }
        } catch (Throwable $e) {
            $this->warn('Relay failed, retrying in 1s: '.$e->getMessage());
            sleep(1);
        }
    }
})->purpose('Apply pending alert changes from the outbox to Redis');

Artisan::command('alerts:rebuild-cache', function () {
    $this->info('Loaded '.AlertCache::rebuild().' active alerts into Redis.');
})->purpose('Reload active alerts from Postgres into Redis (recovery after cache loss)');
