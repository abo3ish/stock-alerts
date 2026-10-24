import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarket, randomWalk, symbolNames } from '../src/market.ts';

test('symbolNames matches the seeder: famous names first, then SYM0007...', () => {
  assert.deepEqual(symbolNames(9), ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'SYM0007', 'SYM0008']);
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
