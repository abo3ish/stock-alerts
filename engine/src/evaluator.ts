// Evaluation Engine: price ticks (Kafka) -> matching alerts (Redis) -> alert-triggered events (Kafka).
import { Kafka, Partitioners } from 'kafkajs';
import { Redis } from 'ioredis';
import { alertsKey, matches, type CachedAlert, type Tick } from './alerts.ts';

const PRICES_TOPIC = process.env.PRICES_TOPIC ?? 'stock-prices';
const TRIGGERED_TOPIC = process.env.TRIGGERED_TOPIC ?? 'alert-triggered';

const kafka = new Kafka({ clientId: 'evaluator', brokers: process.env.KAFKA_BROKERS!.split(',') });
const redis = new Redis(process.env.REDIS_URL!);

const admin = kafka.admin();
await admin.connect();
await admin.createTopics({ topics: [{ topic: TRIGGERED_TOPIC, numPartitions: 3 }] }); // no-op if it exists
await admin.disconnect();

const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
// One group: Kafka splits the 12 price partitions across every running evaluator.
const consumer = kafka.consumer({ groupId: 'evaluator' });
await Promise.all([producer.connect(), consumer.connect()]);
// Not fromBeginning: a brand-new group starts at the latest tick; old prices are worthless.
await consumer.subscribe({ topic: PRICES_TOPIC });

const stats = { ticks: 0, checked: 0, fired: 0, lagSum: 0, lagMax: 0 };
setInterval(() => {
  if (stats.ticks === 0) return;
  console.log(
    `${stats.ticks} ticks/s | ${stats.checked} alerts checked | ${stats.fired} fired | ` +
      `lag avg ${Math.round(stats.lagSum / stats.ticks)}ms max ${stats.lagMax}ms`,
  );
  Object.assign(stats, { ticks: 0, checked: 0, fired: 0, lagSum: 0, lagMax: 0 });
}, 1000);

await consumer.run({
  eachMessage: async ({ message }) => {
    const tick: Tick = JSON.parse(message.value!.toString());

    // ponytail: HGETALL loads every alert of the symbol on every tick: O(alerts per symbol).
    // Fine for few alerts; a hot symbol with 100k alerts is the known bottleneck. Measure, then move to sorted sets.
    const cached = await redis.hgetall(alertsKey(tick.symbol));
    const fired = Object.entries(cached)
      .map(([id, json]) => ({ id, ...(JSON.parse(json) as CachedAlert) }))
      .filter((alert) => matches(alert, tick.price));

    if (fired.length > 0) {
      // Publish first, then remove. A crash in between re-fires on restart (duplicate), it never loses a trigger:
      // at-least-once, so consumers of alert-triggered must dedupe by alert_id.
      await producer.send({
        topic: TRIGGERED_TOPIC,
        messages: fired.map((alert) => ({
          key: alert.id,
          value: JSON.stringify({
            alert_id: Number(alert.id),
            user_id: alert.user_id,
            symbol: tick.symbol,
            condition: alert.condition,
            target_price: alert.target_price,
            price: tick.price,
            tick_ts: tick.ts,
            triggered_at: Date.now(),
          }),
        })),
      });
      await redis.hdel(alertsKey(tick.symbol), ...fired.map((alert) => alert.id));
    }

    // Lag = now minus when the price was produced. The requirement is < 1s end to end.
    const lag = Date.now() - tick.ts;
    stats.ticks++;
    stats.checked += Object.keys(cached).length;
    stats.fired += fired.length;
    stats.lagSum += lag;
    stats.lagMax = Math.max(stats.lagMax, lag);
  },
});

const shutdown = async () => {
  await consumer.disconnect(); // leaves the group cleanly so partitions rebalance at once
  await producer.disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
