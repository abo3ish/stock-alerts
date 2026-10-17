# Image for alert-api's long-running workers (alert-consumer, alert-relay in docker-compose.yml).
# Adds what Herd's static PHP cannot load: rdkafka (Kafka), plus redis, pdo_pgsql
# and pcntl (to catch SIGTERM and stop cleanly).
# No COPY and no CMD: alert-api is mounted at /app, and each service sets its own command.
FROM php:8.4-cli

RUN apt-get update \
    && apt-get install -y --no-install-recommends librdkafka-dev libpq-dev \
    && pecl install rdkafka-6.0.5 redis-6.1.0 \
    && docker-php-ext-enable rdkafka redis \
    && docker-php-ext-install pdo_pgsql pcntl \
    && rm -rf /var/lib/apt/lists/* /tmp/pear

WORKDIR /app
