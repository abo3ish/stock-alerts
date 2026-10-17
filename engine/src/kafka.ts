// Everything Kafka: client, topics, producer/consumer setup, message encoding and kafkajs log formatting.
import { Kafka, Partitioners, logLevel, type LogEntry, type Message } from 'kafkajs';
import { kafkaConfig } from './config.ts';
import { createLogger, paint } from './log.ts';

// kafkajs prints one JSON blob per event. Keep the message and the few fields worth reading.
const kafkaLog = createLogger('kafka', 'blue');

const describe = (log: Record<string, any>): string =>
  [
    log.groupId && `group=${log.groupId}`,
    log.memberAssignment && `partitions=${Object.values(log.memberAssignment).flat().length}`,
    log.retryCount !== undefined && `retry=${log.retryCount}`,
    log.error && `error=${log.error}`,
  ].filter(Boolean).join(' ');

const logCreator = () => ({ level, log }: LogEntry) => {
  const details = describe(log);
  const text = `${String(log.message).replace(/^\[\w+\] /, '')}${details ? '  ' + paint('gray', details) : ''}`;
  if (level === logLevel.ERROR) kafkaLog.error(text);
  else if (level === logLevel.WARN) kafkaLog.warn(text);
  else kafkaLog.info(text);
};

export const createKafka = (clientId: string) => new Kafka({ clientId, brokers: kafkaConfig().brokers, logCreator });

// Create only if missing: createTopics on an existing topic makes kafkajs log a harmless but alarming ERROR.
export async function ensureTopic(kafka: Kafka, topic: string, numPartitions: number) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    if (!(await admin.listTopics()).includes(topic)) {
      await admin.createTopics({ topics: [{ topic, numPartitions }] });
    }
  } finally {
    await admin.disconnect();
  }
}

export async function connectProducer(kafka: Kafka) {
  // Default (murmur2) partitioner: same key -> same partition, compatible with Java Kafka clients.
  const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  return producer;
}

// Not fromBeginning: a brand-new group starts at the latest message; old prices are worthless.
export async function connectConsumer(kafka: Kafka, groupId: string, topic: string) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic });
  return consumer;
}

// The key decides the partition, so it must be the thing whose order matters (symbol for prices).
export const toMessage = (key: string, value: unknown): Message => ({ key, value: JSON.stringify(value) });

export const fromMessage = <T>(value: Buffer | null): T => JSON.parse(value?.toString() ?? 'null');
