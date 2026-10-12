import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTION_API_URL,
  NOTION_VERSION,
  NotionApiError,
  NotionClient,
} from '../src/notion/client.js';

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    return responses.shift();
  };
  return { fetch, calls };
}

const noSleep = async () => {};

test('requests carry the token and the pinned Notion version', async () => {
  const { fetch, calls } = fakeFetch([response(200, { object: 'user' })]);
  await new NotionClient('ntn_secret', { fetch }).me();
  assert.equal(calls[0].url, `${NOTION_API_URL}/users/me`);
  assert.equal(calls[0].headers.Authorization, 'Bearer ntn_secret');
  assert.equal(calls[0].headers['Notion-Version'], NOTION_VERSION);
});

test('a query follows the pagination cursor', async () => {
  const { fetch, calls } = fakeFetch([
    response(200, { results: [{ id: 'a' }], has_more: true, next_cursor: 'c1' }),
    response(200, { results: [{ id: 'b' }], has_more: false, next_cursor: null }),
  ]);
  const filter = { property: 'Date', date: { is_not_empty: true } };
  const pages = await new NotionClient('t', { fetch }).queryDataSource('ds-1', filter);
  assert.deepEqual(
    pages.map((p) => p.id),
    ['a', 'b'],
  );
  assert.equal(calls[0].url, `${NOTION_API_URL}/data_sources/ds-1/query`);
  assert.deepEqual(calls[0].body, { filter, page_size: 100 });
  assert.equal(calls[1].body.start_cursor, 'c1');
});

test('a rate-limited request waits Retry-After and retries', async () => {
  const waits = [];
  const { fetch, calls } = fakeFetch([
    response(429, { code: 'rate_limited' }, { 'retry-after': '2' }),
    response(200, { results: [], has_more: false }),
  ]);
  const client = new NotionClient('t', { fetch, sleep: async (ms) => waits.push(ms) });
  await client.searchDataSources();
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [2000]);
  assert.deepEqual(calls[0].body.filter, { property: 'object', value: 'data_source' });
});

test('a Notion error becomes a NotionApiError with its status and code', async () => {
  const { fetch } = fakeFetch([
    response(401, { code: 'unauthorized', message: 'API token is invalid.' }),
  ]);
  await assert.rejects(
    new NotionClient('t', { fetch, sleep: noSleep }).getDataSource('x'),
    (err) => {
      assert.ok(err instanceof NotionApiError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'unauthorized');
      return true;
    },
  );
});

test('createPage targets the data source', async () => {
  const { fetch, calls } = fakeFetch([response(200, { id: 'p', url: 'https://www.notion.so/p' })]);
  await new NotionClient('t', { fetch }).createPage('ds-1', { Name: { title: [] } });
  assert.deepEqual(calls[0].body.parent, { type: 'data_source_id', data_source_id: 'ds-1' });
  assert.equal(calls[0].method, 'POST');
});

test('a token is required', () => {
  assert.throws(() => new NotionClient(''), /token is required/);
});
