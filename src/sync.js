// -----------------------------------------------------------------------------
// Synchronization engine: Notion databases -> Gladys calendars.
//
// The integration is a calendar provider (manifest `type: "calendar"`): it
// syncs, the core stores. For every user who enabled it, each Notion data
// source holding a date property becomes a Gladys calendar, and each page with
// a date an event of that calendar.
//
// The rules of the core this module follows (see the SDK README, "Calendar
// providers"):
//   - every id is USER-SCOPED, `ext:<selector>:<user_selector>:<notion id>`:
//     two users sharing the same Notion database never collide;
//   - `name` is the integration's, `sync` / `shared` are the user's: a
//     `sync: false` calendar is skipped, never pushed to (403);
//   - the events are pushed with a window, which replaces the window's
//     content: a page deleted (or undated) in Notion disappears from Gladys at
//     the next sync. At most 500 events per request: a bigger window is split
//     into disjoint sub-windows.
//
// On top of the calendars, the engine keeps the synced events in memory for
// the widgets and the scene actions, and fires the integration's own scene
// triggers (`event_created`, `sync_failed`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeAccount, normalizeConfig } from './config.js';
import { NotionApiError, NotionClient } from './notion/client.js';
import {
  buildPageProperties,
  describeDataSource,
  eventBounds,
  extractNotionId,
  overlapsWindow,
  pageToEvent,
} from './notion/mapping.js';

const logger = createLogger({ name: 'sync' });

const DAY_MS = 24 * 60 * 60 * 1000;
// Bounds of the Gladys calendar API.
export const MAX_CALENDARS_PER_USER = 50;
export const MAX_EVENTS_PER_REQUEST = 500;
// Pages whose date starts this long before the window are not queried: an
// event lasting longer than that and ending inside the window is missed.
const QUERY_SLACK_DAYS = 90;

// Scene trigger keys, as declared in the manifest `scene_triggers` field.
export const SCENE_TRIGGERS = {
  EVENT_CREATED: 'event_created',
  SYNC_FAILED: 'sync_failed',
};

/** UTC midnight of the day of `ms`, shifted by `days`. */
function utcMidnight(ms, days = 0) {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

/**
 * Split `[fromMs, toMs)` into chronological, disjoint sub-windows holding at
 * most `max` overlapping events each; a boundary-straddling event belongs to
 * every sub-window it overlaps, as the core requires. Boundaries fall on UTC
 * midnights.
 * @returns {{ from: number, to: number, events: object[] }[]}
 */
export function splitWindow(events, fromMs, toMs, max = MAX_EVENTS_PER_REQUEST) {
  const inside = events.filter((event) => overlapsWindow(event, fromMs, toMs));
  const middle = utcMidnight((fromMs + toMs) / 2);
  if (inside.length <= max || middle <= fromMs || middle >= toMs) {
    if (inside.length > max) {
      logger.warn(`More than ${max} events on a single day: only the first ${max} are synced`);
    }
    return [{ from: fromMs, to: toMs, events: inside.slice(0, max) }];
  }
  return [...splitWindow(inside, fromMs, middle, max), ...splitWindow(inside, middle, toMs, max)];
}

/** Message of a sync error, without any secret. */
export function describeError(err) {
  if (err instanceof NotionApiError) {
    if (err.status === 401) {
      return {
        en: 'Notion refused the token: create a new one and update your account.',
        fr: 'Notion a refusé le jeton : créez-en un nouveau et mettez à jour votre compte.',
      };
    }
    if (err.status === 404 || err.status === 403) {
      return {
        en: 'A database is not shared with the Notion integration (Connections menu of the database).',
        fr: "Une base n'est pas partagée avec l'intégration Notion (menu Connexions de la base).",
      };
    }
    return { en: `Notion error: ${err.message}`, fr: `Erreur Notion : ${err.message}` };
  }
  return { en: `Sync error: ${err.message}`, fr: `Erreur de synchronisation : ${err.message}` };
}

export class CalendarSync {
  /**
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ createClient?: (token: string) => NotionClient, now?: () => number, onSynced?: () => void }} [options]
   */
  constructor(
    gladys,
    { createClient = (token) => new NotionClient(token), now = Date.now, onSynced } = {},
  ) {
    this.gladys = gladys;
    this.createClient = createClient;
    this.now = now;
    this.onSynced = onSynced ?? (() => {});
    this.config = normalizeConfig();
    // userSelector -> { user, calendars: Map<external_id, calendar>, lastSync, error }
    this.users = new Map();
    // userSelector -> Set of the Notion page ids already seen: `event_created`
    // fires for the ids missing from it, never on the first sync of a user.
    this.knownPages = new Map();
    // Pages created by the `create_event` scene action: never announced as
    // `event_created`, a scene bound to it would loop through the integration.
    this.selfCreated = new Set();
    this.timer = null;
    // One sync at a time: a periodic run, a manual one and an account update
    // queue up instead of interleaving their writes.
    this.queue = Promise.resolve();
  }

  // --- Lifecycle --------------------------------------------------------------

  setConfig(config) {
    this.config = normalizeConfig(config);
    if (this.timer) {
      this.schedule();
    }
  }

  schedule() {
    this.stop();
    this.timer = setInterval(
      () => {
        this.syncAll().catch((err) => logger.error('Periodic sync failed', err));
      },
      this.config.sync_interval * 60 * 1000,
    );
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  exclusive(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  // --- Synchronization --------------------------------------------------------

  /** The window synced: whole UTC days, from `past_days` ago to `future_days` ahead. */
  window() {
    const now = this.now();
    return {
      from: utcMidnight(now, -this.config.past_days),
      to: utcMidnight(now, this.config.future_days + 1),
    };
  }

  /**
   * Sync every user who enabled the integration.
   * @returns {Promise<{ users: number, calendars: number, events: number, failed: number }>}
   */
  syncAll() {
    return this.exclusive(async () => {
      const accounts = await this.gladys.getCalendarAccounts();
      const enabled = new Set(accounts.map((account) => account.user.selector));
      for (const selector of this.users.keys()) {
        if (!enabled.has(selector)) {
          // Disabled: the core already destroyed their calendars.
          this.forgetUser(selector);
        }
      }
      for (const account of accounts) {
        await this.syncAccount(account);
      }
      await this.reportStatus();
      this.onSynced();
      return this.summary();
    });
  }

  /** Sync one user, after onCalendarAccountUpdated. */
  syncUser(userSelector) {
    return this.exclusive(async () => {
      const account = (await this.gladys.getCalendarAccounts()).find(
        (candidate) => candidate.user.selector === userSelector,
      );
      if (account) {
        await this.syncAccount(account);
      } else {
        this.forgetUser(userSelector);
      }
      await this.reportStatus();
      this.onSynced();
      return this.summary();
    });
  }

  forgetUser(userSelector) {
    this.users.delete(userSelector);
    this.knownPages.delete(userSelector);
  }

  async syncAccount({ user, config }) {
    const previous = this.users.get(user.selector);
    const state = {
      user,
      account: normalizeAccount(config),
      calendars: previous?.calendars ?? new Map(),
      lastSync: previous?.lastSync ?? null,
      error: null,
    };
    this.users.set(user.selector, state);
    try {
      await this.syncCalendars(state);
      state.lastSync = new Date(this.now()).toISOString();
    } catch (err) {
      state.error = describeError(err);
      logger.error(`Sync of user ${user.selector} failed: ${state.error.en}`);
      // One event per transition: a token that stays invalid does not fire
      // again at every sync.
      if (!previous?.error) {
        await this.fireSceneEvent(SCENE_TRIGGERS.SYNC_FAILED, {
          user: user.first_name || user.selector,
          error: state.error.en,
        });
      }
    }
  }

  async syncCalendars(state) {
    const { user, account } = state;
    if (!account.token) {
      throw new Error('no Notion token in the account');
    }
    const client = this.createClient(account.token);
    const plans = (await this.resolveDataSources(client, account)).slice(0, MAX_CALENDARS_PER_USER);
    const calendarId = (notionId) => this.gladys.externalId(`${user.selector}:${notionId}`);

    if (plans.length > 0) {
      await this.gladys.publishCalendars(
        user.selector,
        plans.map((plan) => ({
          external_id: calendarId(plan.id),
          name: plan.name,
          description: 'Notion',
        })),
      );
    }

    // A database removed from the account, or no longer shared with the
    // Notion integration: its calendar goes, with its events.
    const pushed = new Set(plans.map((plan) => calendarId(plan.id)));
    const stored = await this.gladys.getCalendars(user.selector);
    for (const calendar of stored) {
      if (!pushed.has(calendar.external_id)) {
        await this.gladys.deleteCalendar(calendar.external_id);
      }
    }

    const flags = new Map(stored.map((calendar) => [calendar.external_id, calendar]));
    const { from, to } = this.window();
    const known = this.knownPages.get(user.selector);
    const seen = new Set();
    const calendars = new Map();

    for (const plan of plans) {
      const externalId = calendarId(plan.id);
      // A calendar just created starts with `sync: true`, `shared: false`.
      const { sync = true, shared = false } = flags.get(externalId) ?? {};
      const calendar = { external_id: externalId, plan, sync, shared, events: [] };
      calendars.set(externalId, calendar);
      if (!sync) {
        continue;
      }

      const pages = await client.queryDataSource(plan.id, {
        and: [
          {
            property: plan.dateProperty,
            date: {
              on_or_after: new Date(from - QUERY_SLACK_DAYS * DAY_MS).toISOString().slice(0, 10),
            },
          },
          {
            property: plan.dateProperty,
            date: { before: new Date(to).toISOString().slice(0, 10) },
          },
        ],
      });
      calendar.events = pages
        .map((page) => pageToEvent(page, plan))
        .filter((event) => event && overlapsWindow(event, from, to))
        .map((event) => ({ ...event, external_id: calendarId(event.id) }));

      for (const { from: subFrom, to: subTo, events } of splitWindow(calendar.events, from, to)) {
        await this.gladys.publishCalendarEvents(
          externalId,
          events.map((event) => ({
            external_id: event.external_id,
            name: event.name,
            start: event.start,
            end: event.end,
            full_day: event.fullDay,
            location: event.location,
            url: event.url,
          })),
          { from: new Date(subFrom), to: new Date(subTo) },
        );
      }

      for (const event of calendar.events) {
        seen.add(event.id);
        // Only the household calendars reach the scenes, as in the core.
        if (known && !known.has(event.id) && shared && !this.selfCreated.has(event.id)) {
          await this.fireSceneEvent(SCENE_TRIGGERS.EVENT_CREATED, {
            calendar: plan.name,
            name: event.name,
            start: event.start,
            all_day: event.fullDay,
            url: event.url ?? null,
          });
        }
      }
    }

    // A page leaving then re-entering the window is not "created": keep the
    // ids seen before along with the new ones.
    this.knownPages.set(user.selector, new Set([...(known ?? []), ...seen]));
    state.calendars = calendars;
  }

  /**
   * The data sources of an account, as reading plans: the databases the user
   * listed (a link or an id of a database, or of one of its data sources), or
   * every data source shared with their Notion integration. Data sources
   * without a date property are left out: nothing to show in a calendar.
   */
  async resolveDataSources(client, account) {
    let dataSources;
    if (account.databases.length === 0) {
      dataSources = await client.searchDataSources();
    } else {
      dataSources = [];
      for (const entry of account.databases) {
        const id = extractNotionId(entry);
        if (!id) {
          logger.warn(`Ignored database entry, no Notion id found: ${entry.slice(0, 80)}`);
          continue;
        }
        dataSources.push(...(await this.readDatabase(client, id)));
      }
    }

    const plans = [];
    const ids = new Set();
    for (const dataSource of dataSources) {
      if (!dataSource?.id || ids.has(dataSource.id) || dataSource.in_trash || dataSource.archived) {
        continue;
      }
      ids.add(dataSource.id);
      // The search results carry the schema; fetch it when they do not.
      const full = dataSource.properties ? dataSource : await client.getDataSource(dataSource.id);
      const plan = describeDataSource(full, account.dateProperty);
      if (plan) {
        plans.push(plan);
      }
    }
    return plans;
  }

  async readDatabase(client, id) {
    try {
      const database = await client.getDatabase(id);
      return (database.data_sources ?? []).map((dataSource) => ({ id: dataSource.id }));
    } catch (err) {
      // Not a database id: maybe the id of one of its data sources.
      if (err instanceof NotionApiError && (err.status === 404 || err.status === 400)) {
        return [await client.getDataSource(id)];
      }
      throw err;
    }
  }

  async fireSceneEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      // A refused event (rate limit, older core) never fails the sync.
      logger.warn(`Scene event ${key} not delivered: ${err.message}`);
    }
  }

  async reportStatus() {
    const failed = [...this.users.values()].filter((state) => state.error);
    try {
      if (failed.length === 0) {
        await this.gladys.setConnectionStatus(true);
      } else if (failed.length === 1 && this.users.size === 1) {
        await this.gladys.setConnectionStatus(false, failed[0].error);
      } else {
        await this.gladys.setConnectionStatus(false, {
          en: `${failed.length} of ${this.users.size} accounts cannot sync, check the integration logs.`,
          fr: `${failed.length} comptes sur ${this.users.size} ne se synchronisent pas, consultez les logs.`,
        });
      }
    } catch (err) {
      logger.warn(`Connection status not reported: ${err.message}`);
    }
  }

  // --- Read side: widgets and scene actions -----------------------------------

  summary() {
    let calendars = 0;
    let events = 0;
    let failed = 0;
    for (const state of this.users.values()) {
      calendars += state.calendars.size;
      for (const calendar of state.calendars.values()) {
        events += calendar.events.length;
      }
      failed += state.error ? 1 : 0;
    }
    return { users: this.users.size, calendars, events, failed };
  }

  /** Date of the last successful sync of any user, or null. */
  lastSync() {
    const dates = [...this.users.values()].map((state) => state.lastSync).filter(Boolean);
    return dates.length > 0 ? dates.sort().at(-1) : null;
  }

  /**
   * Calendars visible to the household: `shared` by their owner and synced.
   * A private calendar never reaches a dashboard (public walls exist) nor a
   * scene, as in the core.
   */
  sharedCalendars(calendarName = '') {
    const wanted = calendarName.trim().toLowerCase();
    const calendars = [];
    for (const state of this.users.values()) {
      for (const calendar of state.calendars.values()) {
        if (
          calendar.shared &&
          calendar.sync &&
          (!wanted || calendar.plan.name.toLowerCase() === wanted)
        ) {
          calendars.push({ ...calendar, userSelector: state.user.selector });
        }
      }
    }
    return calendars;
  }

  /**
   * The events of the shared calendars that are not over yet, soonest first.
   * @param {{ calendar?: string, limit?: number }} [options]
   */
  upcomingEvents({ calendar = '', limit = Infinity } = {}) {
    const now = this.now();
    const events = [];
    for (const shared of this.sharedCalendars(calendar)) {
      for (const event of shared.events) {
        const { start, end } = eventBounds(event);
        if ((end ?? start) > now || start >= now) {
          events.push({ ...event, calendar: shared.plan.name, startMs: start });
        }
      }
    }
    return events.sort((a, b) => a.startMs - b.startMs).slice(0, limit);
  }

  /**
   * Create a page in the Notion database of a shared calendar, with the token
   * of its owner, then re-sync that owner so the event shows up at once.
   * @returns {Promise<{ url: string|null }>}
   */
  async createEvent({ calendar, name, start, end, location }) {
    const [target] = this.sharedCalendars(calendar);
    if (!target) {
      throw new Error(`No shared Notion calendar named "${calendar}"`);
    }
    if (!target.plan.titleProperty) {
      throw new Error(`The Notion database "${calendar}" has no title property`);
    }
    const owner = this.users.get(target.userSelector);
    const client = this.createClient(owner.account.token);
    const page = await client.createPage(
      target.plan.id,
      buildPageProperties(target.plan, { name, start, end, location }),
    );
    this.selfCreated.add(page.id);
    await this.syncUser(target.userSelector);
    return { url: page.url ?? null };
  }
}
