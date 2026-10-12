// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Each entry is keyed by the manifest `key`; index.js registers it with
// `gladys.onSceneAction(key, ...)`. The handler receives the RESOLVED fields
// (scene variables substituted, defaults applied) and resolves the declared
// scalar `outputs`. Throwing fails this action only: the scene logs it and
// goes on.
//
// The scene TRIGGERS (`event_created`, `sync_failed`) are fired by the sync
// engine, see src/sync.js. The core's own calendar triggers and actions
// (`calendar.event-is-coming`...) work on the synced calendars too: these
// ones only add what is specific to Notion.
//
// Like the core, the actions only see the calendars their owner SHARED with
// the household: a scene is not a person, it never reads a private calendar.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'scenes' });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value, field) {
  if (DATE_ONLY.test(value) || !Number.isNaN(Date.parse(value))) {
    return value;
  }
  throw new Error(
    `"${field}" must be a date (2026-10-12) or a date-time (2026-10-12T09:00:00+02:00)`,
  );
}

export const SCENE_ACTIONS = {
  // Re-read Notion now instead of waiting for the next periodic sync.
  async sync_now(_gladys, { sync }) {
    logger.info('Scene action sync_now');
    const { calendars, events, failed } = await sync.syncAll();
    return { calendars, events, success: failed === 0 };
  },

  // Add a page to the Notion database of a shared calendar.
  async create_event(_gladys, { fields, sync }) {
    const name = String(fields.name ?? '').trim();
    if (!name) {
      throw new Error('"name" is required');
    }
    const start = checkDate(String(fields.start ?? '').trim(), 'start');
    const end = fields.end ? checkDate(String(fields.end).trim(), 'end') : undefined;
    if (end && DATE_ONLY.test(start) !== DATE_ONLY.test(end)) {
      throw new Error('"start" and "end" must both be dates, or both date-times');
    }
    logger.info(`Scene action create_event <- ${fields.calendar}`);
    const { url } = await sync.createEvent({
      calendar: String(fields.calendar ?? ''),
      name: name.slice(0, 2000),
      start,
      end,
      location: fields.location ? String(fields.location) : undefined,
    });
    return { created: true, url: url ?? '' };
  },

  // The next event of the shared calendars (or of one of them), to branch a
  // scene on it: a missing event is an output, never a failure.
  async get_next_event(_gladys, { fields, sync }) {
    const [next] = sync.upcomingEvents({ calendar: String(fields.calendar ?? ''), limit: 1 });
    if (!next) {
      return { found: false, name: '', start: '', minutes_until: -1, calendar: '', url: '' };
    }
    return {
      found: true,
      name: next.name,
      start: next.start,
      minutes_until: Math.max(0, Math.round((next.startMs - sync.now()) / 60000)),
      calendar: next.calendar,
      url: next.url ?? '',
    };
  },
};
