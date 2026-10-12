// -----------------------------------------------------------------------------
// Integration configuration.
//
// Two forms, both declared in `gladys-assistant-integration.json`:
//   - `config_schema`: the admin settings shared by every user (sync pace,
//     window), fetched with `gladys.getConfig()` and hot-reloaded through
//     `gladys.onConfigUpdated()`;
//   - `account_schema`: what each user types when they enable the calendar
//     (their own Notion token, which databases), read with
//     `gladys.getCalendarAccounts()`.
//
// This module only provides defaults and normalizes the received objects, so
// the rest of the code never has to deal with `undefined` or strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Minutes between two synchronizations of every enabled user.
  sync_interval: 15,
  // Days synchronized before today: past events stay visible in the calendar
  // view, older ones are pruned from Gladys.
  past_days: 30,
  // Days synchronized after today: the horizon of the calendar view, of the
  // `calendar.event-is-coming` trigger and of the widgets.
  future_days: 90,
};

const LIMITS = {
  sync_interval: [5, 1440],
  past_days: [0, 365],
  future_days: [1, 365],
};

function boundedInteger(value, key) {
  const [min, max] = LIMITS[key];
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * Merge the admin config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    sync_interval: boundedInteger(
      raw.sync_interval ?? DEFAULT_CONFIG.sync_interval,
      'sync_interval',
    ),
    past_days: boundedInteger(raw.past_days ?? DEFAULT_CONFIG.past_days, 'past_days'),
    future_days: boundedInteger(raw.future_days ?? DEFAULT_CONFIG.future_days, 'future_days'),
  };
}

/**
 * Normalize the `account_schema` values of one user.
 * @param {Record<string, unknown>} raw `account.config` of getCalendarAccounts()
 * @returns {{ token: string, databases: string[], dateProperty: string }}
 */
export function normalizeAccount(raw = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    token: text(raw.notion_token),
    // Comma, space or newline separated database links or ids; empty means
    // "every database shared with the Notion integration".
    databases: text(raw.databases)
      .split(/[\s,;]+/)
      .filter((entry) => entry.length > 0),
    dateProperty: text(raw.date_property),
  };
}
