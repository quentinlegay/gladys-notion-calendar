// -----------------------------------------------------------------------------
// SDK wiring: every handler registered on the Gladys client, BEFORE connect().
//
// Kept apart from index.js so the tests can wire the same handlers on the fake
// Gladys of the SDK (createFakeGladys) with a fake Notion.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeAccount, normalizeConfig } from './config.js';
import { CalendarSync, describeError } from './sync.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS, refreshWidgets } from './widgets.js';

const logger = createLogger({ name: 'app' });

/**
 * Handlers of the manifest `actions` (buttons of the Configuration screen).
 * The resolved message is displayed under the button.
 */
export const ACTIONS = {
  // Check every enabled account against Notion, without writing to Gladys.
  async test_connection(_gladys, { gladys, sync }) {
    const accounts = await gladys.getCalendarAccounts();
    if (accounts.length === 0) {
      return {
        en: 'No user enabled the integration yet: open "My calendars" on this page.',
        fr: "Aucun utilisateur n'a encore activé l'intégration : ouvrez « Mes calendriers » sur cette page.",
      };
    }
    const lines = { en: [], fr: [] };
    for (const { user, config } of accounts) {
      const who = user.first_name || user.selector;
      const account = normalizeAccount(config);
      try {
        if (!account.token) {
          throw new Error('no Notion token');
        }
        const plans = await sync.resolveDataSources(sync.createClient(account.token), account);
        lines.en.push(`${who}: ${plans.length} database(s) with a date`);
        lines.fr.push(`${who} : ${plans.length} base(s) avec une date`);
      } catch (err) {
        const message = describeError(err);
        lines.en.push(`${who}: ${message.en}`);
        lines.fr.push(`${who} : ${message.fr}`);
      }
    }
    return { en: lines.en.join(' — '), fr: lines.fr.join(' — ') };
  },

  async sync_now(_gladys, { sync }) {
    const { calendars, events, failed } = await sync.syncAll();
    if (failed > 0) {
      throw new Error(`${failed} account(s) could not sync, check the integration logs`);
    }
    return {
      en: `${calendars} calendars and ${events} events synced`,
      fr: `${calendars} calendriers et ${events} événements synchronisés`,
    };
  },
};

/**
 * Register every handler on `gladys`.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {ConstructorParameters<typeof CalendarSync>[1]} [options] e.g. a fake Notion client
 * @returns {CalendarSync}
 */
export function registerHandlers(gladys, options = {}) {
  const sync = new CalendarSync(gladys, { ...options, onSynced: () => refreshWidgets(gladys) });

  // --- Configuration screen buttons -----------------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(gladys, { fields, gladys, sync }));
  }

  // --- Scene actions ----------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(gladys, { fields, sync }));
  }

  // --- Dashboard widgets ------------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, sync }));
    gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
      widget.action(gladys, { actionKey, params, settings, sync }),
    );
  }

  // --- A user enabled / disabled the calendar, changed their account or
  // toggled a calendar's sync / shared flag: the change already applied.
  gladys.onCalendarAccountUpdated(async (userSelector) => {
    logger.info(`onCalendarAccountUpdated <- ${userSelector}`);
    await sync.syncUser(userSelector);
  });

  // --- Admin settings (sync pace, window) -----------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    sync.setConfig(newConfig);
    // A wider or narrower window changes what Gladys holds: resync now.
    await sync.syncAll();
  });

  // --- Connection lifecycle ---------------------------------------------------
  // The account-updated events are lost while disconnected: re-read
  // everything on every (re)connection.
  gladys.on('connected', async () => {
    try {
      sync.setConfig(normalizeConfig(await gladys.getConfig()));
      await sync.syncAll();
      sync.schedule();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => sync.stop());

  return sync;
}
