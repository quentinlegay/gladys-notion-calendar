import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPageProperties,
  describeDataSource,
  extractNotionId,
  overlapsWindow,
  pageToEvent,
  pickDateProperty,
  toInstant,
} from '../src/notion/mapping.js';
import { dataSource, page } from './helpers/fakeNotion.js';

const plan = describeDataSource(dataSource('ds-1', 'Planning'));

test('extractNotionId reads a database link, a dashed id or a raw id', () => {
  const dashed = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  assert.equal(extractNotionId('1a2b3c4d5e6f4a7b8c9d0e1f2a3b4c5d'), dashed);
  assert.equal(extractNotionId(dashed.toUpperCase()), dashed);
  // The `?v=` parameter is a view id, not the database.
  assert.equal(
    extractNotionId(
      'https://www.notion.so/acme/Team-planning-1a2b3c4d5e6f4a7b8c9d0e1f2a3b4c5d?v=ffffffffffffffffffffffffffffffff',
    ),
    dashed,
  );
  assert.equal(extractNotionId('not an id'), null);
});

test('the date property is the named one, else the first date', () => {
  const properties = {
    Name: { type: 'title' },
    Created: { type: 'date' },
    Deadline: { type: 'date' },
  };
  assert.equal(pickDateProperty(properties, 'deadline'), 'Deadline');
  assert.equal(pickDateProperty(properties, 'Unknown'), 'Created');
  assert.equal(pickDateProperty(properties), 'Created');
  assert.equal(pickDateProperty({ Name: { type: 'title' } }), null);
});

test('a data source without a date property has no reading plan', () => {
  const source = dataSource('ds-2', 'Notes');
  delete source.properties.Date;
  assert.equal(describeDataSource(source), null);
});

test('a full-day Notion range becomes an exclusive Gladys range', () => {
  const event = pageToEvent(
    page('p1', 'Holidays', { start: '2026-10-20', end: '2026-10-23' }),
    plan,
  );
  assert.deepEqual(
    { start: event.start, end: event.end, fullDay: event.fullDay },
    { start: '2026-10-20', end: '2026-10-24', fullDay: true },
  );
  const single = pageToEvent(page('p2', 'Birthday', { start: '2026-10-20' }), plan);
  assert.equal(single.end, undefined, 'a missing end covers the start day');
});

test('a timed event keeps its offset as an absolute instant', () => {
  const event = pageToEvent(
    page('p1', 'Meeting', {
      start: '2026-10-12T09:00:00.000+02:00',
      end: '2026-10-12T10:30:00.000+02:00',
    }),
    plan,
  );
  assert.equal(event.fullDay, false);
  assert.equal(event.start, '2026-10-12T07:00:00.000Z');
  assert.equal(event.end, '2026-10-12T08:30:00.000Z');
  assert.equal(event.url, 'https://www.notion.so/p1');
});

test('a wall-clock time with a time zone is converted, DST included', () => {
  assert.equal(toInstant('2026-07-01T09:00:00.000', 'Europe/Paris'), '2026-07-01T07:00:00.000Z');
  assert.equal(toInstant('2026-12-01T09:00:00.000', 'Europe/Paris'), '2026-12-01T08:00:00.000Z');
  assert.equal(toInstant('2026-12-01T09:00:00.000', null), '2026-12-01T09:00:00.000Z');
  assert.equal(toInstant('2026-12-01T09:00:00.000', 'Not/AZone'), '2026-12-01T09:00:00.000Z');
});

test('pages without a date, trashed or untitled are handled', () => {
  assert.equal(pageToEvent(page('p1', 'No date', null), plan), null);
  assert.equal(
    pageToEvent(page('p1', 'Gone', { start: '2026-10-12' }, { in_trash: true }), plan),
    null,
  );
  assert.equal(pageToEvent(page('p1', '', { start: '2026-10-12' }), plan).name, 'Untitled');
  assert.equal(
    pageToEvent(page('p1', 'x'.repeat(300), { start: '2026-10-12' }), plan).name.length,
    200,
  );
});

test('a "Location" text property becomes the event location', () => {
  const source = dataSource('ds-3', 'Trips', { extra: { Lieu: { type: 'rich_text' } } });
  const tripPlan = describeDataSource(source);
  const event = pageToEvent(
    page(
      'p1',
      'Lyon',
      { start: '2026-10-12' },
      { properties: { Lieu: { type: 'rich_text', rich_text: [{ plain_text: 'Gare' }] } } },
    ),
    tripPlan,
  );
  assert.equal(event.location, 'Gare');
  assert.deepEqual(
    buildPageProperties(tripPlan, { name: 'A', start: '2026-10-12', location: 'B' }),
    {
      Name: { title: [{ type: 'text', text: { content: 'A' } }] },
      Date: { date: { start: '2026-10-12' } },
      Lieu: { rich_text: [{ type: 'text', text: { content: 'B' } }] },
    },
  );
});

test('the German and Spanish location property names are recognized too', () => {
  for (const name of ['Ort', 'Standort', 'Lugar', 'Ubicación', 'Dirección']) {
    const source = dataSource('ds-4', 'Trips', { extra: { [name]: { type: 'rich_text' } } });
    assert.equal(describeDataSource(source).locationProperty, name);
  }
});

test('overlapsWindow follows the pruning rule of the core', () => {
  const from = Date.parse('2026-10-01T00:00:00Z');
  const to = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(overlapsWindow({ start: '2026-10-15', fullDay: true }, from, to), true);
  assert.equal(overlapsWindow({ start: '2026-09-30', fullDay: true }, from, to), false);
  assert.equal(
    overlapsWindow({ start: '2026-09-28', end: '2026-10-02', fullDay: true }, from, to),
    true,
  );
  assert.equal(
    overlapsWindow({ start: '2026-11-01T00:00:00.000Z', fullDay: false }, from, to),
    false,
  );
  assert.equal(
    overlapsWindow({ start: '2026-10-01T00:00:00.000Z', fullDay: false }, from, to),
    true,
  );
});
