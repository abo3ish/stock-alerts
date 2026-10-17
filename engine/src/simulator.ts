// Stands in for the external market-data provider: random-walk prices -> Kafka.
// ponytail: produces straight to Kafka, no separate Ingestion Service; add one when a real provider needs normalizing.
import { Kafka, Partitioners } from 'kafkajs';

const TOPIC = process.env.PRICES_TOPIC ?? 'stock-prices';
const SYMBOLS = Number(process.env.SYMBOLS ?? 5000);
const TICKS_PER_SEC = Number(process.env.TICKS_PER_SEC ?? 2000);
const PARTITIONS = 12;
const BATCH_MS = 100;

const famous = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'];
const symbols = Array.from({ length: SYMBOLS }, (_, i) => famous[i] ?? `SYM${String(i).padStart(4, '0')}`);
const prices = new Map(symbols.map((s) => [s, 50 + Math.random() * 450]));

// ponytail: uniform symbol pick; real markets are skewed (hot symbols), add weighting when we study hot partitions.
function nextTick() {
  const symbol = symbols[Math.floor(Math.random() * symbols.length)];
  const price = Math.max(0.01, prices.get(symbol)! * (1 + (Math.random() - 0.5) * 0.004));
  prices.set(symbol, price);
  return { symbol, price: Math.round(price * 100) / 100, ts: Date.now() };
}

const kafka = new Kafka({ clientId: 'price-simulator', brokers: process.env.KAFKA_BROKERS!.split(',') });

const admin = kafka.admin();
await admin.connect();
await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: PARTITIONS }] }); // no-op if it exists
await admin.disconnect();

const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
await producer.connect();

let running = true;
process.on('SIGINT', () => (running = false));

const perBatch = Math.max(1, Math.round((TICKS_PER_SEC * BATCH_MS) / 1000));
let sent = 0;
const report = setInterval(() => {
  console.log(`${sent} ticks/s`);
  sent = 0;
}, 1000);

console.log(`Producing ~${TICKS_PER_SEC} ticks/s for ${SYMBOLS} symbols to "${TOPIC}" (${PARTITIONS} partitions)`);
while (running) {
  const started = Date.now();
  const ticks = Array.from({ length: perBatch }, nextTick);
  // key = symbol -> same symbol always hashes to the same partition, so its ticks stay in order.
  await producer.send({
    topic: TOPIC,
    messages: ticks.map((t) => ({ key: t.symbol, value: JSON.stringify(t) })),
  });
  sent += ticks.length;
  await new Promise((r) => setTimeout(r, Math.max(0, BATCH_MS - (Date.now() - started))));
}

clearInterval(report);
await producer.disconnect();
console.log('Stopped');
