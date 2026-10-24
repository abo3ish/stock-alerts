<?php

use App\Services\AlertCache;
use App\Services\AlertTriggered;
use Illuminate\Support\Facades\Artisan;

// Runs in the alert-relay container (docker-compose.yml). Run exactly one: two relays can race on an alert.
// Ctrl+C / docker stop finish the current batch first; even a hard kill is safe (the batch rolls back and is retried).
// ponytail: polls every 200ms when idle; Postgres LISTEN/NOTIFY or CDC (Debezium) when that latency matters.
Artisan::command('alerts:relay', function () {
    $running = true;
    pcntl_async_signals(true);
    pcntl_signal(SIGTERM, function () use (&$running) { $running = false; });
    pcntl_signal(SIGINT, function () use (&$running) { $running = false; });

    $this->info('Relaying alert_outbox -> Redis. Ctrl+C to stop.');
    while ($running) {
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
    $this->info('Relay stopped.');
})->purpose('Apply pending alert changes from the outbox to Redis');

// Needs ext-rdkafka, which Herd's static PHP lacks: runs in the alert-consumer container (docker-compose.yml).
// No need to start it by hand: docker compose up starts it and restarts it on failure.
// Any error exits the process; Docker restarts it and Kafka redelivers from the last committed offset.
Artisan::command('alerts:consume-triggered', function () {
    $conf = new RdKafka\Conf;
    $conf->set('bootstrap.servers', config('services.kafka.brokers'));
    $conf->set('group.id', 'alert-api');
    $conf->set('auto.offset.reset', 'earliest'); // a new group must not skip triggers published before it existed
    $conf->set('enable.auto.commit', 'false');   // commit only after Postgres has the change

    $consumer = new RdKafka\KafkaConsumer($conf);
    $consumer->subscribe([config('services.kafka.triggered_topic')]);
    $this->info('Consuming '.config('services.kafka.triggered_topic').'. Ctrl+C to stop.');

    // On docker stop/restart, leave the group cleanly. Killed without close(), Kafka waits for the dead member
    // until the session timeout (45s) before reassigning its partitions: nothing is consumed meanwhile.
    $running = true;
    pcntl_async_signals(true);
    pcntl_signal(SIGTERM, function () use (&$running) { $running = false; });
    pcntl_signal(SIGINT, function () use (&$running) { $running = false; });

    while ($running) {
        $message = $consumer->consume(1000);

        if ($message->err === RD_KAFKA_RESP_ERR__TIMED_OUT || $message->err === RD_KAFKA_RESP_ERR__PARTITION_EOF) {
            continue;
        }
        if ($message->err !== RD_KAFKA_RESP_ERR_NO_ERROR) {
            throw new RuntimeException($message->errstr());
        }

        $event = json_decode($message->payload, true, flags: JSON_THROW_ON_ERROR);
        $applied = AlertTriggered::handle($event);
        $consumer->commit($message);

        $this->line(($applied ? 'triggered' : 'duplicate, skipped').' alert '.$event['alert_id']);
    }

    $consumer->close();
    $this->info('Left the consumer group.');
})->purpose('Apply alert-triggered events from the Evaluation Engine to Postgres');

Artisan::command('alerts:rebuild-cache', function () {
    $this->info('Loaded '.AlertCache::rebuild().' active alerts into Redis.');
})->purpose('Reload active alerts from Postgres into Redis (recovery after cache loss)');
