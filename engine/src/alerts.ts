// Alert rules: pure functions only (no Redis, no Kafka), so they are trivial to test.

// Contract with alert-api (app/Services/AlertCache.php):
//   hash alerts:{SYMBOL}   field = alert id   value = JSON CachedAlert
export type CachedAlert = { user_id: number; target_price: number; condition: 'above' | 'below' };
export type Alert = CachedAlert & { id: string };
export type Tick = { symbol: string; price: number; ts: number };

// Contract with alert-api's alerts:consume-triggered (app/Services/AlertTriggered.php).
export type TriggeredEvent = {
  alert_id: number;
  user_id: number;
  symbol: string;
  condition: CachedAlert['condition'];
  target_price: number;
  price: number;
  tick_ts: number;
  triggered_at: number;
};

export const alertsKey = (symbol: string) => `alerts:${symbol}`;

// HGETALL result -> alerts.
export const parseAlerts = (hash: Record<string, string>): Alert[] =>
  Object.entries(hash).map(([id, json]) => ({ id, ...(JSON.parse(json) as CachedAlert) }));

// State, not crossing: an "above 200" alert created while the price is already 210 fires on the next tick.
export const matches = (alert: CachedAlert, price: number): boolean =>
  alert.condition === 'above' ? price >= alert.target_price : price <= alert.target_price;

export const triggeredBy = (alerts: Alert[], price: number): Alert[] => alerts.filter((alert) => matches(alert, price));

export const toTriggeredEvent = (alert: Alert, tick: Tick, now: number): TriggeredEvent => ({
  alert_id: Number(alert.id),
  user_id: alert.user_id,
  symbol: tick.symbol,
  condition: alert.condition,
  target_price: alert.target_price,
  price: tick.price,
  tick_ts: tick.ts,
  triggered_at: now,
});
