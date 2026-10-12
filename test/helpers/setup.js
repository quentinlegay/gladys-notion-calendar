// A fake Gladys (SDK) + a fake Notion, wired with the integration's handlers.

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FakeNotion, TOKEN, dataSource, page } from './fakeNotion.js';

export const NOW = Date.parse('2026-10-12T07:30:00.000Z');
export const PLANNING = '11111111-1111-4111-8111-111111111111';
export const TASKS = '22222222-2222-4222-8222-222222222222';

export const alice = { selector: 'alice', first_name: 'Alice', language: 'fr' };

export function setup({ accounts, notion } = {}) {
  const fakeNotion =
    notion ??
    new FakeNotion()
      .add(dataSource(PLANNING, 'Planning'), [
        page('aaaaaaaa-0000-4000-8000-000000000001', 'Team meeting', {
          start: '2026-10-12T09:00:00.000+02:00',
          end: '2026-10-12T10:00:00.000+02:00',
        }),
        page('aaaaaaaa-0000-4000-8000-000000000002', 'Holidays', {
          start: '2026-10-20',
          end: '2026-10-23',
        }),
        page('aaaaaaaa-0000-4000-8000-000000000003', 'Long ago', { start: '2025-01-01' }),
      ])
      .add(dataSource(TASKS, 'Tasks', { dateProperty: 'Due' }), [
        page(
          'bbbbbbbb-0000-4000-8000-000000000001',
          'Taxes',
          { start: '2026-10-15' },
          { dateProperty: 'Due' },
        ),
      ]);
  const gladys = createFakeGladys({
    config: {},
    calendarAccounts: accounts ?? [{ user: alice, config: { notion_token: TOKEN } }],
  });
  const sync = registerHandlers(gladys, { createClient: fakeNotion.createClient, now: () => NOW });
  return { gladys, sync, notion: fakeNotion };
}

/** Flip the user-owned toggles like the user would in Gladys. */
export function setFlags(gladys, externalId, flags) {
  const calendar = gladys.fake.calendars.find((candidate) => candidate.external_id === externalId);
  Object.assign(calendar, flags);
}
