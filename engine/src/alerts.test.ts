import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches } from './alerts.ts';

const alert = (condition: 'above' | 'below') => ({ user_id: 1, target_price: 200, condition });

test('above fires at or over the target', () => {
  assert.equal(matches(alert('above'), 199.99), false);
  assert.equal(matches(alert('above'), 200), true);
  assert.equal(matches(alert('above'), 250), true);
});

test('below fires at or under the target', () => {
  assert.equal(matches(alert('below'), 200.01), false);
  assert.equal(matches(alert('below'), 200), true);
  assert.equal(matches(alert('below'), 150), true);
});
