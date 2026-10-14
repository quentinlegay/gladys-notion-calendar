import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  AGENDA_SUMMARY_WIDGET,
  UPCOMING_EVENTS_WIDGET,
  WIDGETS,
  formatDelay,
} from '../src/widgets.js';
import { PLANNING, TASKS, setFlags, setup } from './helpers/setup.js';

let current;
afterEach(() => current?.sync.stop());

async function connected({ share = true } = {}) {
  current = setup();
  await current.gladys.connect();
  if (share) {
    const { gladys } = current;
    setFlags(gladys, gladys.externalId(`alice:${PLANNING}`), { shared: true });
    setFlags(gladys, gladys.externalId(`alice:${TASKS}`), { shared: true });
    await current.sync.syncAll();
  }
  return current;
}

const content = async (gladys, key, settings = {}) => {
  const ack = await gladys.fake.widgetGet(key, { settings, language: 'en', units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

test('every widget content is rendered exactly as sent', async () => {
  const { gladys } = await connected();
  for (const key of Object.keys(WIDGETS)) {
    assert.deepEqual(validateWidgetContent(await content(gladys, key)), [], key);
  }
});

test('every widget text is translated in en, fr, de and es', async () => {
  const check = (node) => {
    if (Array.isArray(node)) {
      node.forEach(check);
    } else if (node && typeof node === 'object') {
      if (typeof node.en === 'string') {
        for (const lang of ['fr', 'de', 'es']) {
          assert.ok(node[lang], `missing "${lang}": ${JSON.stringify(node)}`);
        }
      }
      Object.values(node).forEach(check);
    }
  };
  for (const share of [true, false]) {
    const { gladys } = await connected({ share });
    for (const key of Object.keys(WIDGETS)) {
      check(await content(gladys, key));
    }
    current.sync.stop();
  }
});

test('the empty states are valid too, and leak no private calendar', async () => {
  const { gladys } = await connected({ share: false });
  for (const key of Object.keys(WIDGETS)) {
    const data = await content(gladys, key);
    assert.deepEqual(validateWidgetContent(data), [], key);
    assert.doesNotMatch(JSON.stringify(data), /Team meeting|Taxes|Holidays/);
  }
});

test('the agenda lists the next events, filtered and capped by the settings', async () => {
  const { gladys } = await connected();
  const list = (data) => data.components.find((component) => component.type === 'card-list');

  const all = list(await content(gladys, UPCOMING_EVENTS_WIDGET));
  assert.deepEqual(
    all.items.map((item) => item.title),
    ['Team meeting', 'Taxes', 'Holidays'],
  );
  assert.equal(all.items[0].badge.text.en, 'Now');
  assert.equal(all.items[2].badge.text.en, 'All day');
  assert.equal(all.items[0].links[0].url.startsWith('https://www.notion.so/'), true);

  const capped = list(await content(gladys, UPCOMING_EVENTS_WIDGET, { max_events: 1 }));
  assert.equal(capped.items.length, 1);
  const tasks = list(await content(gladys, UPCOMING_EVENTS_WIDGET, { calendar: 'Tasks' }));
  assert.deepEqual(
    tasks.items.map((item) => item.title),
    ['Taxes'],
  );
});

test('the summary counts the upcoming events', async () => {
  const { gladys } = await connected();
  const data = await content(gladys, AGENDA_SUMMARY_WIDGET);
  const tiles = data.components.filter((component) => component.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.value),
    [1, 2, { en: '3 d', fr: '3 j', de: '3 T.', es: '3 d' }],
  );
});

test('the sync button syncs and answers a toast', async () => {
  const { gladys } = await connected();
  for (const key of Object.keys(WIDGETS)) {
    const ack = await gladys.fake.widgetAction(key, 'sync', {}, { settings: {} });
    assert.equal(ack.success, true);
    assert.equal(ack.data.message.en, '3 events synced');
  }
  const unknown = await gladys.fake.widgetAction(
    UPCOMING_EVENTS_WIDGET,
    'nope',
    {},
    { settings: {} },
  );
  assert.equal(unknown.success, false);
});

test('every sync nudges the widgets', async () => {
  const { gladys, sync } = await connected();
  const before = gladys.fake.widgetRefreshes.length;
  await sync.syncAll();
  assert.deepEqual(gladys.fake.widgetRefreshes.slice(before).sort(), Object.keys(WIDGETS).sort());
});

test('formatDelay fits a tile', () => {
  assert.equal(formatDelay(35 * 60000), '35 min');
  assert.equal(formatDelay(125 * 60000), '2 h 05');
  assert.deepEqual(formatDelay(3 * 24 * 60 * 60000), {
    en: '3 d',
    fr: '3 j',
    de: '3 T.',
    es: '3 d',
  });
});
