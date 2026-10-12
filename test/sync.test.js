import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { splitWindow } from '../src/sync.js';
import { FakeNotion, TOKEN, dataSource, page } from './helpers/fakeNotion.js';
import { PLANNING, TASKS, alice, setFlags, setup } from './helpers/setup.js';

let current;
afterEach(async () => {
  current?.sync.stop();
  current = undefined;
});

function start(options) {
  current = setup(options);
  return current;
}

const calendarId = (gladys, user, id) => gladys.externalId(`${user}:${id}`);

test('every dated database becomes a user-scoped calendar', async () => {
  const { gladys } = start();
  await gladys.connect();
  const names = gladys.fake.calendars.map((calendar) => [calendar.external_id, calendar.name]);
  assert.deepEqual(names, [
    [calendarId(gladys, 'alice', PLANNING), 'Planning'],
    [calendarId(gladys, 'alice', TASKS), 'Tasks'],
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('events are pushed with a window, out-of-window pages left out', async () => {
  const { gladys } = start();
  await gladys.connect();
  const events = gladys.fake.calendarEvents.filter(
    (event) => event.calendar_external_id === calendarId(gladys, 'alice', PLANNING),
  );
  assert.deepEqual(
    events.map((event) => [event.name, event.start, event.end ?? null, event.full_day ?? false]),
    [
      ['Team meeting', '2026-10-12T07:00:00.000Z', '2026-10-12T08:00:00.000Z', false],
      ['Holidays', '2026-10-20', '2026-10-24', true],
    ],
  );
  const batch = gladys.fake.publishedCalendarEvents.at(-1);
  // past_days 30, future_days 90, on whole UTC days.
  assert.deepEqual(gladys.fake.publishedCalendarEvents[0].window, {
    from: '2026-09-12T00:00:00.000Z',
    to: '2027-01-11T00:00:00.000Z',
  });
  assert.ok(batch.window);
});

test('a page deleted in Notion is pruned at the next sync', async () => {
  const { gladys, sync, notion } = start();
  await gladys.connect();
  notion.pages(PLANNING).splice(0, 1);
  await sync.syncAll();
  const names = gladys.fake.calendarEvents.map((event) => event.name).sort();
  assert.deepEqual(names, ['Holidays', 'Taxes']);
});

test('a calendar the user turned off is never pushed to', async () => {
  const { gladys, sync } = start();
  await gladys.connect();
  setFlags(gladys, calendarId(gladys, 'alice', TASKS), { sync: false });
  const before = gladys.fake.publishedCalendarEvents.length;
  await sync.syncAll();
  const pushed = gladys.fake.publishedCalendarEvents
    .slice(before)
    .map((b) => b.calendar_external_id);
  assert.deepEqual(pushed, [calendarId(gladys, 'alice', PLANNING)]);
});

test('a database no longer shared deletes its calendar', async () => {
  const { gladys, sync, notion } = start();
  await gladys.connect();
  notion.sources.delete(TASKS);
  await sync.syncAll();
  assert.deepEqual(gladys.fake.deletedCalendars, [calendarId(gladys, 'alice', TASKS)]);
});

test('listed databases restrict the sync, and the date property is chosen', async () => {
  const notion = new FakeNotion()
    .add(
      dataSource(PLANNING, 'Planning', { extra: { Deadline: { type: 'date' } } }),
      [
        page(
          'cccccccc-0000-4000-8000-000000000001',
          'Report',
          { start: '2026-10-30' },
          { dateProperty: 'Deadline' },
        ),
      ],
      '99999999-9999-4999-8999-999999999999',
    )
    .add(dataSource(TASKS, 'Tasks'));
  const { gladys } = start({
    notion,
    accounts: [
      {
        user: alice,
        config: {
          notion_token: TOKEN,
          databases: 'https://www.notion.so/acme/Planning-99999999999949998999999999999999?v=123',
          date_property: 'deadline',
        },
      },
    ],
  });
  await gladys.connect();
  assert.deepEqual(
    gladys.fake.calendars.map((c) => c.name),
    ['Planning'],
  );
  assert.equal(notion.queries[0].filter.and[0].property, 'Deadline');
  assert.deepEqual(
    gladys.fake.calendarEvents.map((e) => e.name),
    ['Report'],
  );
});

test('event_created fires for new pages of shared calendars only, not on the first sync', async () => {
  const { gladys, sync, notion } = start();
  await gladys.connect();
  assert.deepEqual(gladys.fake.sceneEvents, []);

  setFlags(gladys, calendarId(gladys, 'alice', PLANNING), { shared: true });
  notion
    .pages(PLANNING)
    .push(page('aaaaaaaa-0000-4000-8000-000000000009', 'Dentist', { start: '2026-10-14' }));
  notion
    .pages(TASKS)
    .push(
      page(
        'bbbbbbbb-0000-4000-8000-000000000009',
        'Private',
        { start: '2026-10-14' },
        { dateProperty: 'Due' },
      ),
    );
  await sync.syncAll();

  assert.equal(gladys.fake.sceneEvents.length, 1);
  assert.equal(gladys.fake.sceneEvents[0].key, 'event_created');
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    calendar: 'Planning',
    name: 'Dentist',
    start: '2026-10-14',
    all_day: true,
    url: 'https://www.notion.so/aaaaaaaa000040008000000000000009',
  });
});

test('an invalid token fails that user once, and reports the connection status', async () => {
  const { gladys, sync } = start({
    accounts: [
      { user: alice, config: { notion_token: 'ntn_revoked' } },
      {
        user: { selector: 'bob', first_name: 'Bob', language: 'en' },
        config: { notion_token: TOKEN },
      },
    ],
  });
  await gladys.connect();
  await sync.syncAll();
  const failures = gladys.fake.sceneEvents.filter((event) => event.key === 'sync_failed');
  assert.equal(failures.length, 1, 'one event per transition');
  assert.equal(failures[0].data.user, 'Alice');
  assert.match(failures[0].data.error, /token/);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  // Bob still syncs.
  assert.ok(gladys.fake.calendars.some((calendar) => calendar.user === 'bob'));
  // No secret in the status.
  assert.doesNotMatch(JSON.stringify(gladys.fake.connectionStatuses), /ntn_/);
});

test('a disabled user is forgotten on account update', async () => {
  const { gladys, sync } = start();
  await gladys.connect();
  assert.equal(sync.summary().users, 1);
  gladys.fake.calendarAccounts = [];
  await gladys.fake.calendarAccountUpdated('alice');
  assert.equal(sync.summary().users, 0);
});

test('an account update re-syncs that user', async () => {
  const { gladys, notion } = start();
  await gladys.connect();
  notion.add(dataSource('33333333-3333-4333-8333-333333333333', 'Content'));
  await gladys.fake.calendarAccountUpdated('alice');
  assert.ok(gladys.fake.calendars.some((calendar) => calendar.name === 'Content'));
});

test('splitWindow keeps at most 500 events per request, straddlers in both', () => {
  const from = Date.parse('2026-10-01T00:00:00Z');
  const to = Date.parse('2026-10-11T00:00:00Z');
  const events = [];
  for (let i = 0; i < 900; i += 1) {
    events.push({ start: new Date(from + i * 15 * 60 * 1000).toISOString(), fullDay: false });
  }
  events.push({ start: '2026-10-01', end: '2026-10-11', fullDay: true });
  const windows = splitWindow(events, from, to);
  assert.ok(windows.length > 1);
  for (const window of windows) {
    assert.ok(window.events.length <= 500);
    assert.ok(window.events.includes(events.at(-1)), 'the 10-day event straddles every boundary');
  }
  assert.equal(windows[0].from, from);
  assert.equal(windows.at(-1).to, to);
  const total = windows.reduce((sum, window) => sum + window.events.length, 0);
  assert.equal(total, 900 + windows.length);
});

test('upcomingEvents only reads shared calendars, soonest first', async () => {
  const { gladys, sync } = start();
  await gladys.connect();
  assert.deepEqual(sync.upcomingEvents(), []);
  setFlags(gladys, calendarId(gladys, 'alice', PLANNING), { shared: true });
  setFlags(gladys, calendarId(gladys, 'alice', TASKS), { shared: true });
  await sync.syncAll();
  assert.deepEqual(
    sync.upcomingEvents().map((event) => event.name),
    ['Team meeting', 'Taxes', 'Holidays'],
  );
  assert.deepEqual(
    sync.upcomingEvents({ calendar: 'tasks' }).map((e) => e.name),
    ['Taxes'],
  );
});
