// Per-second metrics: pure reducers (empty / add / format) plus one generic reporter that prints them.
import { duration, health, num, paint, sep } from './log.ts';

// Accumulate samples with a pure reducer, print one summary line per second, reset. Shared by both services.
export function createReporter<State, Sample>(
  empty: () => State,
  add: (state: State, sample: Sample) => State,
  format: (state: State) => string | null, // null = nothing worth printing this second
  print: (line: string) => void,
) {
  let state = empty();
  const timer = setInterval(() => {
    const line = format(state);
    if (line) print(line);
    state = empty();
  }, 1000);
  return Object.freeze({
    record: (sample: Sample) => void (state = add(state, sample)),
    stop: () => clearInterval(timer),
  });
}

// --- Simulator ---

export type ProducerStats = { sent: number };

export const emptyProducerStats = (): ProducerStats => ({ sent: 0 });

export const addSent = (stats: ProducerStats, count: number): ProducerStats => ({ sent: stats.sent + count });

// Yellow when Kafka can't take the target rate.
export const formatProducerStats = (target: number) => (stats: ProducerStats): string =>
  `${paint('bold', paint(stats.sent >= target * 0.9 ? 'green' : 'yellow', num(stats.sent).padStart(6)))} ticks/s`;

// --- Evaluator ---

export type TickSample = { symbol: string; checked: number; fired: number; lagMs: number; tookMs: number };

export type EvaluatorStats = Readonly<{
  ticks: number;
  checked: number;
  fired: number;
  lagSum: number;
  lagMax: number;
  busyMs: number;
  slowestMs: number;
  slowestSymbol: string;
}>;

export const emptyEvaluatorStats = (): EvaluatorStats => ({
  ticks: 0, checked: 0, fired: 0, lagSum: 0, lagMax: 0, busyMs: 0, slowestMs: 0, slowestSymbol: '',
});

export const addTick = (stats: EvaluatorStats, sample: TickSample): EvaluatorStats => ({
  ticks: stats.ticks + 1,
  checked: stats.checked + sample.checked,
  fired: stats.fired + sample.fired,
  lagSum: stats.lagSum + sample.lagMs,
  lagMax: Math.max(stats.lagMax, sample.lagMs),
  busyMs: stats.busyMs + sample.tookMs,
  ...(sample.tookMs > stats.slowestMs
    ? { slowestMs: sample.tookMs, slowestSymbol: sample.symbol }
    : { slowestMs: stats.slowestMs, slowestSymbol: stats.slowestSymbol }),
});

// Lag = now minus when the price was produced (requirement: < 1s end to end).
// busy = share of the second spent evaluating; near 100% means this consumer is saturated.
// Pad before painting: color codes would throw the column widths off.
export const formatEvaluatorStats = (stats: EvaluatorStats): string | null => {
  if (stats.ticks === 0) return null;
  const lagAvg = stats.lagSum / stats.ticks;
  const busy = Math.round(stats.busyMs / 10);
  return [
    `${paint('bold', num(stats.ticks).padStart(6))} ticks/s`,
    `checked ${num(stats.checked).padStart(9)}`,
    `fired ${paint(stats.fired ? 'magenta' : 'gray', num(stats.fired).padStart(4))}`,
    `lag avg ${paint(health(lagAvg, 200, 1000), duration(lagAvg).padStart(6))} max ${paint(health(stats.lagMax, 500, 1000), duration(stats.lagMax).padStart(6))}`,
    `busy ${paint(health(busy, 70, 90), `${busy}%`.padStart(4))}`,
    `slowest ${duration(stats.slowestMs).padStart(5)} ${paint('gray', stats.slowestSymbol)}`,
  ].join(` ${sep} `);
};
