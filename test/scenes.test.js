import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PLANNING, setFlags, setup } from './helpers/setup.js';

let current;
afterEach(() => current?.sync.stop());

async function connected() {
  current = setup();
  await current.gladys.connect();
  const { gladys } = current;
  setFlags(gladys, gladys.externalId(`alice:${PLANNING}`), { shared: true });
  await current.sync.syncAll();
  return current;
}

test('sync_now returns the counts of what was synced', async () => {
  const { gladys } = await connected();
  const ack = await gladys.fake.sceneAction('sync_now', {});
  assert.deepEqual(ack, {
    success: true,
    data: { outputs: { calendars: 2, events: 3, success: true } },
  });
});

test('get_next_event reads the shared calendars only', async () => {
  const { gladys } = await connected();
  const ack = await gladys.fake.sceneAction('get_next_event', { calendar: '' });
  assert.equal(ack.data.outputs.found, true);
  assert.equal(ack.data.outputs.name, 'Team meeting');
  assert.equal(ack.data.outputs.calendar, 'Planning');
  assert.equal(ack.data.outputs.minutes_until, 0, 'already started');

  // Tasks is private: as if it did not exist.
  const tasks = await gladys.fake.sceneAction('get_next_event', { calendar: 'Tasks' });
  assert.equal(tasks.data.outputs.found, false);
});

test('create_event writes to Notion, re-syncs, and never fires event_created', async () => {
  const { gladys, notion } = await connected();
  const ack = await gladys.fake.sceneAction('create_event', {
    calendar: 'Planning',
    name: 'Plumber',
    start: '2026-10-13T14:00:00+02:00',
    end: '2026-10-13T15:00:00+02:00',
  });
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.created, true);
  assert.match(ack.data.outputs.url, /^https:\/\/www\.notion\.so\//);
  assert.equal(notion.created[0].dataSourceId, PLANNING);
  assert.deepEqual(notion.created[0].properties.Date, {
    date: { start: '2026-10-13T14:00:00+02:00', end: '2026-10-13T15:00:00+02:00' },
  });
  assert.ok(gladys.fake.calendarEvents.some((event) => event.name === 'Plumber'));
  assert.deepEqual(gladys.fake.sceneEvents, [], 'no loop through the integration');
});

test('create_event refuses a private calendar and invalid dates', async () => {
  const { gladys } = await connected();
  const privateCalendar = await gladys.fake.sceneAction('create_event', {
    calendar: 'Tasks',
    name: 'x',
    start: '2026-10-13',
  });
  assert.equal(privateCalendar.success, false);
  const badDate = await gladys.fake.sceneAction('create_event', {
    calendar: 'Planning',
    name: 'x',
    start: 'tomorrow',
  });
  assert.equal(badDate.success, false);
  const mixed = await gladys.fake.sceneAction('create_event', {
    calendar: 'Planning',
    name: 'x',
    start: '2026-10-13',
    end: '2026-10-13T10:00:00Z',
  });
  assert.equal(mixed.success, false);
});
