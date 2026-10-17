// Simulated market: pure price math plus one closure that remembers the last price per symbol.
import type { Tick } from './alerts.ts';

const FAMOUS = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'];

// Same names the Laravel LoadTestSeeder uses: AAPL..META, then SYM0007..SYM4999.
export const symbolNames = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => FAMOUS[i] ?? `SYM${String(i).padStart(4, '0')}`);

// One random-walk step of at most ±maxStep (0.2%), never below one cent. `rand` is in [0, 1).
export const randomWalk = (price: number, rand: number, maxStep = 0.002): number =>
  Math.max(0.01, price * (1 + (rand - 0.5) * 2 * maxStep));

export const roundCents = (price: number): number => Math.round(price * 100) / 100;

/**
 * Returns a tick generator. `rand` is injectable so tests are deterministic.
 * ponytail: uniform symbol pick; real markets are skewed (hot symbols), add weighting when we study hot partitions.
 */
export function createMarket(symbols: string[], rand: () => number = Math.random) {
  const prices = new Map(symbols.map((symbol) => [symbol, 50 + rand() * 450]));

  return (now: number = Date.now()): Tick => {
    const symbol = symbols[Math.floor(rand() * symbols.length)];
    const price = randomWalk(prices.get(symbol)!, rand());
    prices.set(symbol, price);
    return { symbol, price: roundCents(price), ts: now };
  };
}
