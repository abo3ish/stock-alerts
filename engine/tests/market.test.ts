import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarket, randomWalk, symbolNames } from '../src/market.ts';

test('symbolNames reads shared/symbols.json: hot names first, every name unique', () => {
  const names = symbolNames(5000);
  // LoadTestSeeder gives these 7 the most alerts, so they must stay first.
  assert.deepEqual(names.slice(0, 7), ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META']);
  assert.equal(new Set(names).size, 5000, 'a duplicate name would be picked more often and share one Redis key');
  assert.throws(() => symbolNames(5001), /only 5000 names/);
});

test('randomWalk moves at most ±0.2% and never below one cent', () => {
  assert.equal(randomWalk(100, 0.5), 100);
  assert.ok(Math.abs(randomWalk(100, 0) - 99.8) < 1e-9);
  assert.ok(Math.abs(randomWalk(100, 1) - 100.2) < 1e-9);
  assert.equal(randomWalk(0.01, 0), 0.01);
});

test('createMarket is deterministic with an injected random source', () => {
  const sequence = () => {
    let i = 0;
    const values = [0.1, 0.9, 0.3, 0.7];
    return () => values[i++ % values.length];
  };
  const a = createMarket(['AAPL', 'TSLA'], sequence());
  const b = createMarket(['AAPL', 'TSLA'], sequence());
  assert.deepEqual([a(1), a(2)], [b(1), b(2)]);
  assert.equal(a(3).ts, 3);
});
