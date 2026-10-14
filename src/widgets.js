// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// Each entry of WIDGETS is keyed by the manifest widget `key` and exposes:
//   - get(gladys, { settings, language, sync }): the declarative content,
//     registered by index.js with `gladys.onWidgetGet(key, ...)`;
//   - action(gladys, { actionKey, params, sync }): a tapped `button`,
//     registered with `gladys.onWidgetAction(key, ...)`.
//
// A dashboard can hang on a public wall and its acting user is anonymous:
// the widgets only show the calendars their owner SHARED with the household,
// never a private one.
//
// The content is served from the core cache until `ttl_seconds`; the sync
// engine nudges every widget (requestWidgetRefresh) after each sync.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'widgets' });

export const UPCOMING_EVENTS_WIDGET = 'upcoming_events';
export const AGENDA_SUMMARY_WIDGET = 'agenda_summary';

// Keys of the `button` actions the contents declare.
export const WIDGET_ACTIONS = { SYNC: 'sync' };

export const DEFAULT_MAX_EVENTS = 5;
// A `list` card-list shows 8 rows at most.
const MAX_LIST_ITEMS = 8;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const syncButton = {
  type: 'button',
  label: { en: 'Sync now', fr: 'Synchroniser', de: 'Synchronisieren', es: 'Sincronizar' },
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: WIDGET_ACTIONS.SYNC },
};

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "35 min", "2 h 05", "3 d" / "3 j": at most 12 characters, as a tile wants. */
export function formatDelay(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  const days = Math.round(minutes / (24 * 60));
  return { en: `${days} d`, fr: `${days} j`, de: `${days} T.`, es: `${days} d` };
}

function maxEvents(settings) {
  const value = Math.round(Number(settings?.max_events));
  return Number.isFinite(value) && value >= 1
    ? Math.min(value, MAX_LIST_ITEMS)
    : DEFAULT_MAX_EVENTS;
}

async function runSync(sync) {
  const { events, failed } = await sync.syncAll();
  if (failed > 0) {
    // Throwing acks the action as failed: the message reaches the user.
    throw new Error(`${failed} account(s) could not sync, check the integration logs`);
  }
  return {
    en: `${events} events synced`,
    fr: `${events} événements synchronisés`,
    de: `${events} Termine synchronisiert`,
    es: `${events} eventos sincronizados`,
  };
}

async function handleAction(_gladys, { widgetKey, actionKey, sync }) {
  logger.info(`onWidgetAction <- ${widgetKey}.${actionKey}`);
  if (actionKey === WIDGET_ACTIONS.SYNC) {
    return runSync(sync);
  }
  throw new Error(`Unknown widget action: ${actionKey}`);
}

export const WIDGETS = {
  // The next events of the shared calendars, soonest first.
  [UPCOMING_EVENTS_WIDGET]: {
    async get(_gladys, { settings = {}, sync }) {
      const calendar = typeof settings.calendar === 'string' ? settings.calendar : '';
      const events = sync.upcomingEvents({ calendar, limit: maxEvents(settings) });
      const now = sync.now();
      const components = [];

      if (events.length === 0) {
        components.push({
          type: 'text',
          variant: 'body',
          text: {
            en: 'No upcoming event. Only the calendars shared with the household are shown here.',
            fr: 'Aucun événement à venir. Seuls les calendriers partagés avec la maison sont affichés ici.',
            de: 'Kein anstehender Termin. Hier werden nur die mit dem Haushalt geteilten Kalender angezeigt.',
            es: 'Ningún evento próximo. Aquí solo se muestran los calendarios compartidos con el hogar.',
          },
        });
      } else {
        components.push({
          type: 'card-list',
          display: 'list',
          items: events.map((event) => {
            const item = {
              title: truncate(event.name, 60),
              subtitle: truncate(
                event.location ? `${event.calendar} · ${event.location}` : event.calendar,
                60,
              ),
              date: event.start,
            };
            if (event.startMs <= now) {
              item.badge = {
                text: { en: 'Now', fr: 'En cours', de: 'Läuft', es: 'En curso' },
                color: WIDGET_COLORS.SUCCESS,
              };
            } else if (event.fullDay) {
              item.badge = {
                text: { en: 'All day', fr: 'Journée', de: 'Ganztägig', es: 'Todo el día' },
                color: WIDGET_COLORS.INFO,
              };
            }
            if (event.url && event.url.startsWith('https://')) {
              item.links = [
                {
                  url: event.url,
                  label: {
                    en: 'Open in Notion',
                    fr: 'Ouvrir dans Notion',
                    de: 'In Notion öffnen',
                    es: 'Abrir en Notion',
                  },
                },
              ];
            }
            return item;
          }),
        });
      }
      components.push(syncButton);
      return { ttl_seconds: 300, components };
    },

    action(gladys, { actionKey, sync }) {
      return handleAction(gladys, { widgetKey: UPCOMING_EVENTS_WIDGET, actionKey, sync });
    },
  },

  // Counters and sync health at a glance.
  [AGENDA_SUMMARY_WIDGET]: {
    async get(_gladys, { sync }) {
      const now = sync.now();
      const events = sync.upcomingEvents();
      const startingWithin = (ms) => events.filter((event) => event.startMs < now + ms).length;
      const next = events.find((event) => event.startMs > now);
      const { users, failed } = sync.summary();
      const lastSync = sync.lastSync();

      return {
        ttl_seconds: 300,
        components: [
          {
            type: 'value',
            label: {
              en: 'Next 24 hours',
              fr: 'Prochaines 24 h',
              de: 'Nächste 24 h',
              es: 'Próximas 24 h',
            },
            icon: 'calendar',
            value: startingWithin(DAY_MS),
          },
          {
            type: 'value',
            label: {
              en: 'Next 7 days',
              fr: '7 prochains jours',
              de: 'Nächste 7 Tage',
              es: 'Próximos 7 días',
            },
            icon: 'calendar',
            value: startingWithin(7 * DAY_MS),
          },
          {
            type: 'value',
            label: {
              en: 'Next event in',
              fr: 'Prochain dans',
              de: 'Nächster in',
              es: 'Próximo en',
            },
            icon: 'clock',
            value: next ? formatDelay(next.startMs - now) : '-',
          },
          {
            type: 'status',
            items: [
              {
                label: {
                  en: 'Next event',
                  fr: 'Prochain événement',
                  de: 'Nächster Termin',
                  es: 'Próximo evento',
                },
                icon: 'bookmark',
                value: next
                  ? truncate(next.name, 40)
                  : { en: 'None', fr: 'Aucun', de: 'Keiner', es: 'Ninguno' },
                color: next ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
              },
              {
                label: {
                  en: 'Notion accounts',
                  fr: 'Comptes Notion',
                  de: 'Notion-Konten',
                  es: 'Cuentas de Notion',
                },
                icon: 'users',
                value:
                  failed > 0
                    ? {
                        en: `${failed} of ${users} failing`,
                        fr: `${failed} sur ${users} en erreur`,
                        de: `${failed} von ${users} fehlerhaft`,
                        es: `${failed} de ${users} con error`,
                      }
                    : users,
                color: failed > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
              },
              {
                label: {
                  en: 'Last sync',
                  fr: 'Dernière synchro',
                  de: 'Letzte Synchronisierung',
                  es: 'Última sincronización',
                },
                icon: 'refresh-cw',
                value: lastSync
                  ? formatAgo(now - Date.parse(lastSync))
                  : { en: 'Never', fr: 'Jamais', de: 'Nie', es: 'Nunca' },
                color: lastSync ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.WARNING,
              },
            ],
          },
          syncButton,
        ],
      };
    },

    action(gladys, { actionKey, sync }) {
      return handleAction(gladys, { widgetKey: AGENDA_SUMMARY_WIDGET, actionKey, sync });
    },
  },
};

/** "5 min ago" / "il y a 5 min" / "vor 5 Min." / "hace 5 min", at most 40 characters, as a status row wants. */
export function formatAgo(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) {
    return { en: 'just now', fr: "à l'instant", de: 'gerade eben', es: 'ahora mismo' };
  }
  if (minutes < 60) {
    return {
      en: `${minutes} min ago`,
      fr: `il y a ${minutes} min`,
      de: `vor ${minutes} Min.`,
      es: `hace ${minutes} min`,
    };
  }
  const hours = Math.round(minutes / 60);
  return {
    en: `${hours} h ago`,
    fr: `il y a ${hours} h`,
    de: `vor ${hours} Std.`,
    es: `hace ${hours} h`,
  };
}

/**
 * Freshness nudge: ask the core to re-pull every widget now (after a sync).
 * Fire-and-forget, rate-limited core-side, dropped while disconnected.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
