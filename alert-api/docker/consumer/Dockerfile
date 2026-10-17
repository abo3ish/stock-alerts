# PHP with the extensions Herd's static build cannot load: rdkafka (Kafka), plus redis, pdo_pgsql
# and pcntl (to catch SIGTERM and leave the consumer group cleanly).
# No COPY: the alert-api folder is mounted at /app (see docker-compose.yml), so code edits apply on restart.
FROM php:8.4-cli

RUN apt-get update \
    && apt-get install -y --no-install-recommends librdkafka-dev libpq-dev \
    && pecl install rdkafka-6.0.5 redis-6.1.0 \
    && docker-php-ext-enable rdkafka redis \
    && docker-php-ext-install pdo_pgsql pcntl \
    && rm -rf /var/lib/apt/lists/* /tmp/pear

WORKDIR /app
CMD ["php", "artisan", "alerts:consume-triggered"]
