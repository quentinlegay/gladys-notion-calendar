// -----------------------------------------------------------------------------
// Notion -> Gladys mapping: pure functions, no I/O.
//
// A Notion database shown in Notion Calendar is a data source with a `date`
// property; each page (row) holding a date is an event. Notion writes a date
// property as `{ start, end, time_zone }`:
//   - `start: '2026-10-12'` (no time): a full-day event, `end` INCLUSIVE;
//   - `start: '2026-10-12T09:00:00.000+02:00'`: a timed event, `end` optional;
//   - `time_zone: 'Europe/Paris'`: the times carry no offset and are wall-clock
//     times of that zone.
// Gladys wants a full-day `end` EXCLUSIVE (the iCalendar convention) and
// timed events as absolute instants.
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const NOTION_ID = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Bounds of the Gladys calendar API (see the SDK README).
export const MAX_CALENDAR_NAME_LENGTH = 100;
export const MAX_EVENT_NAME_LENGTH = 200;
export const MAX_LOCATION_LENGTH = 500;

// Property names read as the location of an event, lowercased.
const LOCATION_PROPERTY_NAMES = new Set([
  'location',
  'lieu',
  'place',
  'address',
  'adresse',
  'where',
  'où',
]);

/**
 * Notion id (dashed UUID) found in a database link or a raw id, or null.
 * In a link, the database id is the last one of the path: `?v=` is a view.
 * @param {string} input
 */
export function extractNotionId(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const path = input.split('?')[0];
  const matches = path.match(NOTION_ID);
  if (!matches) {
    return null;
  }
  const hex = matches[matches.length - 1].replaceAll('-', '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Concatenated plain text of a Notion rich text array. */
export function plainText(richText) {
  if (!Array.isArray(richText)) {
    return '';
  }
  return richText
    .map((part) => part?.plain_text ?? part?.text?.content ?? '')
    .join('')
    .trim();
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Display name of a data source (its title, else its database name). */
export function dataSourceName(dataSource, fallback = 'Notion') {
  const name = plainText(dataSource?.title) || dataSource?.name || fallback;
  return truncate(name, MAX_CALENDAR_NAME_LENGTH);
}

function findProperty(properties, predicate) {
  return Object.entries(properties ?? {}).find(([name, property]) =>
    predicate(name, property),
  )?.[0];
}

/**
 * Name of the date property that places the pages in the calendar: the one
 * the user named (case-insensitive) when the data source has it, else the
 * first date property of the schema. null when there is none: such a data
 * source has nothing to show in a calendar.
 */
export function pickDateProperty(properties, preferred = '') {
  const wanted = preferred.trim().toLowerCase();
  if (wanted) {
    const named = findProperty(
      properties,
      (name, property) => property?.type === 'date' && name.toLowerCase() === wanted,
    );
    if (named) {
      return named;
    }
  }
  return findProperty(properties, (_name, property) => property?.type === 'date') ?? null;
}

/** Name of the title property (every data source has exactly one). */
export function pickTitleProperty(properties) {
  return findProperty(properties, (_name, property) => property?.type === 'title') ?? null;
}

/** Name of a text property holding a location ("Location", "Lieu"...), or null. */
export function pickLocationProperty(properties) {
  return (
    findProperty(
      properties,
      (name, property) =>
        ['rich_text', 'select'].includes(property?.type) &&
        LOCATION_PROPERTY_NAMES.has(name.trim().toLowerCase()),
    ) ?? null
  );
}

/** The schema-derived reading plan of a data source, or null when it has no date. */
export function describeDataSource(dataSource, preferredDateProperty = '') {
  const dateProperty = pickDateProperty(dataSource?.properties, preferredDateProperty);
  if (!dateProperty) {
    return null;
  }
  const locationProperty = pickLocationProperty(dataSource.properties);
  return {
    id: dataSource.id,
    name: dataSourceName(dataSource),
    dateProperty,
    titleProperty: pickTitleProperty(dataSource.properties),
    locationProperty,
    locationType: locationProperty ? dataSource.properties[locationProperty].type : null,
  };
}

// Offset (ms) of `timeZone` at the instant `utcMs`: the wall-clock time the
// zone shows, read back as if it were UTC, minus the instant.
function zoneOffsetMs(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map(({ type, value }) => [type, value]),
  );
  const wallClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wallClock - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Absolute ISO instant of a Notion date-time. A value with an offset is
 * absolute already; a value without one is a wall-clock time of `timeZone`
 * (UTC when Notion gives none).
 * @param {string} value e.g. '2026-10-12T09:00:00.000' or '2026-10-12T09:00:00.000+02:00'
 * @param {string|null} timeZone IANA zone, e.g. 'Europe/Paris'
 */
export function toInstant(value, timeZone) {
  if (HAS_OFFSET.test(value) || !timeZone) {
    const ms = Date.parse(HAS_OFFSET.test(value) ? value : `${value}Z`);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const asUtc = Date.parse(`${value}Z`);
  if (Number.isNaN(asUtc)) {
    return null;
  }
  try {
    // Two passes: the offset at the guessed instant, then at the corrected
    // one, so a time next to a DST change lands on the right side.
    const first = asUtc - zoneOffsetMs(asUtc, timeZone);
    return new Date(asUtc - zoneOffsetMs(first, timeZone)).toISOString();
  } catch {
    // An unknown zone name: read the wall-clock time as UTC.
    return new Date(asUtc).toISOString();
  }
}

/** The day after a `YYYY-MM-DD` date. */
export function nextDay(date) {
  return new Date(Date.parse(date) + DAY_MS).toISOString().slice(0, 10);
}

function propertyText(property) {
  if (!property) {
    return '';
  }
  if (property.type === 'select') {
    return property.select?.name ?? '';
  }
  if (property.type === 'rich_text') {
    return plainText(property.rich_text);
  }
  if (property.type === 'title') {
    return plainText(property.title);
  }
  return '';
}

/**
 * Event of a Notion page, or null when the page has no date (or is trashed).
 * @param {object} page Notion page object
 * @param {{ dateProperty: string, titleProperty: string|null, locationProperty: string|null }} plan
 * @returns {{ id: string, name: string, start: string, end?: string, fullDay: boolean, location?: string, url?: string } | null}
 */
export function pageToEvent(page, plan) {
  if (!page || page.in_trash || page.archived) {
    return null;
  }
  const date = page.properties?.[plan.dateProperty]?.date;
  if (!date?.start) {
    return null;
  }

  const name =
    truncate(propertyText(page.properties?.[plan.titleProperty]), MAX_EVENT_NAME_LENGTH) ||
    'Untitled';
  const event = { id: page.id, name, fullDay: DATE_ONLY.test(date.start) };

  if (event.fullDay) {
    event.start = date.start;
    // Notion's end day is inclusive, Gladys' exclusive.
    if (date.end) {
      event.end = nextDay(date.end.slice(0, 10));
    }
  } else {
    event.start = toInstant(date.start, date.time_zone);
    if (!event.start) {
      return null;
    }
    const end = date.end ? toInstant(date.end, date.time_zone) : null;
    if (end && Date.parse(end) >= Date.parse(event.start)) {
      event.end = end;
    }
  }

  const location = truncate(
    propertyText(page.properties?.[plan.locationProperty]),
    MAX_LOCATION_LENGTH,
  );
  if (location) {
    event.location = location;
  }
  if (typeof page.url === 'string' && /^https?:\/\//.test(page.url)) {
    event.url = page.url;
  }
  return event;
}

/**
 * Bounds of an event in ms, the way the Gladys core reads them to prune a
 * window: a full-day event spans whole days (read here at UTC midnights), a
 * missing `end` covers the start day (full day) or is the start (timed).
 */
export function eventBounds(event) {
  const start = Date.parse(event.start);
  if (event.fullDay) {
    return { start, end: event.end ? Date.parse(event.end) : start + DAY_MS };
  }
  return { start, end: event.end ? Date.parse(event.end) : undefined };
}

/** Whether an event overlaps `[from, to)` by the rule of the core. */
export function overlapsWindow(event, fromMs, toMs) {
  const { start, end } = eventBounds(event);
  return start < toMs && ((end !== undefined && end > fromMs) || start >= fromMs);
}

/**
 * Notion properties of a new page: title, date and optional location.
 * @param {{ titleProperty: string, dateProperty: string, locationProperty: string|null, locationType: string|null }} plan
 * @param {{ name: string, start: string, end?: string, location?: string }} input
 */
export function buildPageProperties(plan, { name, start, end, location }) {
  const properties = {
    [plan.titleProperty]: { title: [{ type: 'text', text: { content: name } }] },
    [plan.dateProperty]: { date: { start, ...(end ? { end } : {}) } },
  };
  if (location && plan.locationProperty) {
    properties[plan.locationProperty] =
      plan.locationType === 'select'
        ? { select: { name: location.slice(0, 100) } }
        : { rich_text: [{ type: 'text', text: { content: location } }] };
  }
  return properties;
}
