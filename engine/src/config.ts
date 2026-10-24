import process from 'node:process';
// All env reading lives here, so a missing variable fails at startup with a clear message,
// not later as `undefined.split`. Each service asks only for the config it needs.

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name} (see engine/.env)`);
  return value;
};

const optional = (name: string, fallback: string): string => process.env[name] || fallback;

const positiveInt = (name: string, fallback: number): number => {
  const value = Number(optional(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Env ${name} must be a positive integer, got "${value}"`);
  return value;
};

// Shared by both services: the topic names are the contract between them.
export const kafkaConfig = () =>
  Object.freeze({
    brokers: required('KAFKA_BROKERS').split(','),
    pricesTopic: optional('PRICES_TOPIC', 'stock-prices'),
    pricePartitions: 12, // upper bound on parallel evaluators
    triggeredTopic: optional('TRIGGERED_TOPIC', 'alert-triggered'),
    triggeredPartitions: 3,
  });

export const simulatorConfig = () =>
  Object.freeze({
    symbols: positiveInt('SYMBOLS', 5000),
    ticksPerSec: positiveInt('TICKS_PER_SEC', 2000),
    batchMs: 100,
  });

export const evaluatorConfig = () =>
  Object.freeze({
    redisUrl: required('REDIS_URL'),
    groupId: 'evaluator', // every evaluator joins this group; Kafka splits the price partitions between them
  });
