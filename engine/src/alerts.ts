// Contract with alert-api (app/Services/AlertCache.php):
//   hash alerts:{SYMBOL}   field = alert id   value = JSON CachedAlert
export type CachedAlert = { user_id: number; target_price: number; condition: 'above' | 'below' };
export type Tick = { symbol: string; price: number; ts: number };

export const alertsKey = (symbol: string) => `alerts:${symbol}`;

// State, not crossing: an "above 200" alert created while the price is already 210 fires on the next tick.
export function matches(alert: CachedAlert, price: number): boolean {
  return alert.condition === 'above' ? price >= alert.target_price : price <= alert.target_price;
}
