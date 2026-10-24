import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Condition, alertsFromData, dataKey, matches, satisfiedRange, setKey, toTriggeredEvent, triggeredBy, type Alert,
} from '../src/alerts.ts';

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

test('keys match the layout alert-api writes', () => {
  assert.equal(setKey(Condition.Above, 'AAPL'), 'alerts:above:AAPL');
  assert.equal(setKey(Condition.Below, 'AAPL'), 'alerts:below:AAPL');
  assert.equal(dataKey('AAPL'), 'alerts:data:AAPL');
});

// The range must agree with matches(): asking Redis for it returns exactly what matches() would keep.
test('satisfiedRange covers exactly the targets matches() fires on', () => {
  assert.deepEqual(satisfiedRange(Condition.Above, 187.4), ['-inf', '187.4']); // targets <= price
  assert.deepEqual(satisfiedRange(Condition.Below, 187.4), ['187.4', '+inf']); // targets >= price
  for (const [condition, target] of [[Condition.Above, 187.4], [Condition.Above, 187.41], [Condition.Below, 187.4], [Condition.Below, 187.39]] as const) {
    // Redis spells infinity "-inf"/"+inf"; Number() would turn those into NaN.
    const [min, max] = satisfiedRange(condition, 187.4).map((bound) => (bound === '-inf' ? -Infinity : bound === '+inf' ? Infinity : Number(bound)));
    assert.equal(target >= min && target <= max, matches(alert('1', condition, target), 187.4), `${condition} ${target}`);
  }
});

test('alertsFromData pairs HMGET values with ids and skips missing data', () => {
  const data = ['{"user_id":42,"target_price":210,"condition":"above"}', null];
  assert.deepEqual(alertsFromData(['7', '8'], data), [{ id: '7', user_id: 42, target_price: 210, condition: 'above' }]);
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
