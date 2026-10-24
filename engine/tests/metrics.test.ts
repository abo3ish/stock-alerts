import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTick, emptyEvaluatorStats, formatEvaluatorStats } from '../src/metrics.ts';

const sample = (symbol: string, tookMs: number, lagMs = 10) => ({ symbol, checked: 100, fired: 1, lagMs, tookMs });

test('addTick sums, keeps the max lag and the slowest symbol, without mutating', () => {
  const empty = emptyEvaluatorStats();
  const stats = [sample('AAPL', 5, 30), sample('TSLA', 9, 10), sample('MSFT', 2, 20)].reduce(addTick, empty);

  assert.equal(stats.ticks, 3);
  assert.equal(stats.checked, 300);
  assert.equal(stats.lagMax, 30);
  assert.equal(stats.busyMs, 16);
  assert.equal(stats.slowestSymbol, 'TSLA');
  assert.equal(empty.ticks, 0); // the reducer returned new objects
});

test('formatEvaluatorStats prints nothing for an idle second', () => {
  assert.equal(formatEvaluatorStats(emptyEvaluatorStats()), null);
  assert.match(formatEvaluatorStats(addTick(emptyEvaluatorStats(), sample('AAPL', 1)))!, /1 ticks\/s/);
});
