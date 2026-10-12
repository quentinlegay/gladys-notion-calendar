import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeAccount, normalizeConfig } from '../src/config.js';

test('normalizeConfig applies the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig coerces form strings and clamps to the manifest bounds', () => {
  const config = normalizeConfig({ sync_interval: '30', past_days: -4, future_days: 9999 });
  assert.equal(config.sync_interval, 30);
  assert.equal(config.past_days, 0);
  assert.equal(config.future_days, 365);
  assert.equal(normalizeConfig({ sync_interval: 'abc' }).sync_interval, 15);
  assert.equal(normalizeConfig({ sync_interval: 1 }).sync_interval, 5);
});

test('normalizeAccount splits the database list and trims the token', () => {
  assert.deepEqual(
    normalizeAccount({
      notion_token: '  ntn_x ',
      databases: 'https://notion.so/a, b\nc ;d',
      date_property: ' Due ',
    }),
    { token: 'ntn_x', databases: ['https://notion.so/a', 'b', 'c', 'd'], dateProperty: 'Due' },
  );
  assert.deepEqual(normalizeAccount(), { token: '', databases: [], dateProperty: '' });
});
