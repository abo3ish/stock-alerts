import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, parseAlerts, toTriggeredEvent, triggeredBy, type Alert } from './alerts.ts';

const alert = (id: string, condition: 'above' | 'below', target_price: number): Alert => ({ id, user_id: 1, target_price, condition });

test('above fires at or over the target', () => {
  assert.equal(matches(alert('1', 'above', 200), 199.99), false);
  assert.equal(matches(alert('1', 'above', 200), 200), true);
  assert.equal(matches(alert('1', 'above', 200), 250), true);
});

test('below fires at or under the target', () => {
  assert.equal(matches(alert('1', 'below', 200), 200.01), false);
  assert.equal(matches(alert('1', 'below', 200), 200), true);
  assert.equal(matches(alert('1', 'below', 200), 150), true);
});

test('parseAlerts reads the Redis hash layout written by alert-api', () => {
  const hash = { '7': '{"user_id":42,"target_price":210,"condition":"above"}' };
  assert.deepEqual(parseAlerts(hash), [{ id: '7', user_id: 42, target_price: 210, condition: 'above' }]);
});

test('triggeredBy keeps only the alerts the price satisfies', () => {
  const alerts = [alert('1', 'above', 200), alert('2', 'above', 300), alert('3', 'below', 250)];
  assert.deepEqual(triggeredBy(alerts, 260).map((a) => a.id), ['1']);
});

test('toTriggeredEvent matches the shape alert-api consumes', () => {
  const event = toTriggeredEvent(alert('7', 'above', 200), { symbol: 'AAPL', price: 210.5, ts: 1000 }, 1050);
  assert.deepEqual(event, {
    alert_id: 7, user_id: 1, symbol: 'AAPL', condition: 'above', target_price: 200, price: 210.5, tick_ts: 1000, triggered_at: 1050,
  });
});
