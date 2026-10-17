// Evaluation Engine: price ticks (Kafka) -> matching alerts (Redis) -> alert-triggered events (Kafka).
// Shell only: wiring and I/O. Matching rules are in alerts.ts, metrics in metrics.ts.
import { Redis } from 'ioredis';
import { alertsKey, parseAlerts, toTriggeredEvent, triggeredBy, type Alert, type Tick } from './alerts.ts';
import { evaluatorConfig, kafkaConfig } from './config.ts';
import { connectConsumer, connectProducer, createKafka, ensureTopic, fromMessage, toMessage } from './kafka.ts';
import { onShutdown } from './lifecycle.ts';
import { createLogger, num, paint } from './log.ts';
import { addTick, createReporter, emptyEvaluatorStats, formatEvaluatorStats } from './metrics.ts';

const kafkaCfg = kafkaConfig();
const cfg = evaluatorConfig();
const log = createLogger('evaluator', 'cyan');

const redis = new Redis(cfg.redisUrl);
redis.on('error', (e) => log.error(`redis: ${e.message}`));

const kafka = createKafka('evaluator');
await ensureTopic(kafka, kafkaCfg.triggeredTopic, kafkaCfg.triggeredPartitions);
const [producer, consumer] = await Promise.all([
  connectProducer(kafka),
  connectConsumer(kafka, cfg.groupId, kafkaCfg.pricesTopic),
]);

const reporter = createReporter(emptyEvaluatorStats, addTick, formatEvaluatorStats, log.info);

// ponytail: HGETALL loads every alert of the symbol on every tick: O(alerts per symbol).
// bench.sh shows it saturates at ~1M alerts; the fix is sorted sets (query only the price range that matches).
const loadAlerts = async (symbol: string): Promise<Alert[]> => parseAlerts(await redis.hgetall(alertsKey(symbol)));

const logFired = (tick: Tick, fired: Alert[]) => {
  for (const alert of fired.slice(0, 5)) {
    log.info(paint('magenta', `fired alert ${alert.id}: ${tick.symbol} ${alert.condition} ${alert.target_price}, price ${tick.price} (user ${alert.user_id})`));
  }
  if (fired.length > 5) log.info(paint('magenta', `...and ${num(fired.length - 5)} more on ${tick.symbol}`));
};

// Publish first, then remove. A crash in between re-fires on restart (duplicate) but never loses a trigger:
// at-least-once, so consumers of alert-triggered must dedupe by alert_id.
async function fire(tick: Tick, fired: Alert[]) {
  const now = Date.now();
  await producer.send({
    topic: kafkaCfg.triggeredTopic,
    messages: fired.map((alert) => toMessage(alert.id, toTriggeredEvent(alert, tick, now))),
  });
  await redis.hdel(alertsKey(tick.symbol), ...fired.map((alert) => alert.id));
  logFired(tick, fired);
}

async function evaluate(tick: Tick) {
  const alerts = await loadAlerts(tick.symbol);
  const fired = triggeredBy(alerts, tick.price);
  if (fired.length > 0) await fire(tick, fired);
  return { checked: alerts.length, fired: fired.length };
}

log.info(`${kafkaCfg.pricesTopic} -> alerts:{SYMBOL} in Redis -> ${kafkaCfg.triggeredTopic}`);

await consumer.run({
  eachMessage: async ({ message }) => {
    const started = performance.now();
    const tick = fromMessage<Tick>(message.value);
    const result = await evaluate(tick);
    reporter.record({ symbol: tick.symbol, ...result, lagMs: Date.now() - tick.ts, tookMs: performance.now() - started });
  },
});

onShutdown(async () => {
  log.info('stopping...');
  reporter.stop();
  await consumer.disconnect(); // leave the group cleanly so partitions rebalance at once, not after the 45s timeout
  await producer.disconnect();
  redis.disconnect();
});
