// Price simulator: stands in for the external market-data provider. Random-walk prices -> Kafka.
// ponytail: produces straight to Kafka, no separate Ingestion Service; add one when a real provider needs normalizing.
// Shell only: setup and the produce loop. Price logic is in market.ts, metrics in metrics.ts.
import { kafkaConfig, simulatorConfig } from './config.ts';
import { connectProducer, createKafka, ensureTopic, toMessage } from './kafka.ts';
import { onShutdown, sleep } from './lifecycle.ts';
import { createLogger, num } from './log.ts';
import { createMarket, symbolNames } from './market.ts';
import { addSent, createReporter, emptyProducerStats, formatProducerStats } from './metrics.ts';

const kafkaCfg = kafkaConfig();
const cfg = simulatorConfig();
const log = createLogger('simulator', 'green');

const kafka = createKafka('price-simulator');
await ensureTopic(kafka, kafkaCfg.pricesTopic, kafkaCfg.pricePartitions);
const producer = await connectProducer(kafka);

const nextTick = createMarket(symbolNames(cfg.symbols));
const perBatch = Math.max(1, Math.round((cfg.ticksPerSec * cfg.batchMs) / 1000));
const reporter = createReporter(emptyProducerStats, addSent, formatProducerStats(cfg.ticksPerSec), log.info);

let running = true;
let total = 0;

// One batch per batchMs: one network round trip for many ticks.
// key = symbol -> a symbol always lands on the same partition, so its ticks stay in order.
async function produceLoop() {
  while (running) {
    const started = Date.now();
    const ticks = Array.from({ length: perBatch }, () => nextTick());
    await producer.send({ topic: kafkaCfg.pricesTopic, messages: ticks.map((tick) => toMessage(tick.symbol, tick)) });
    reporter.record(ticks.length);
    total += ticks.length;
    await sleep(Math.max(0, cfg.batchMs - (Date.now() - started)));
  }
}

log.info(`~${num(cfg.ticksPerSec)} ticks/s for ${num(cfg.symbols)} symbols -> ${kafkaCfg.pricesTopic} (${kafkaCfg.pricePartitions} partitions)`);
const loop = produceLoop();

// Finish the batch in flight, then disconnect: no tick is half-sent.
onShutdown(async () => {
  running = false;
  await loop;
  reporter.stop();
  await producer.disconnect();
  log.info(`stopped after ${num(total)} ticks`);
});
