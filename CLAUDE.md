# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `calendar`: a Node.js
service (Node 22+, ESM, no build step) that runs in its own sandboxed Docker
container and syncs the Notion databases shown in Notion Calendar into the
Gladys calendar store. It talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to Notion through its REST API
(`api.notion.com`, version pinned in `src/notion/client.js`) with the global
`fetch`. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

Notion Calendar has no public API: it displays the Notion databases (data
sources) that have a `date` property, and so does this integration.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/sync.test.js             # one file
node --test --test-name-pattern "window"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 24: run the three commands before pushing.

## Architecture

```
index.js                          bootstrap only: new GladysIntegration(), registerHandlers, connect()
src/app.js                        SDK wiring (handlers registered before connect) + manifest `actions`
src/sync.js                       CalendarSync: Notion -> Gladys sync, scene triggers, in-memory read side
src/notion/client.js              Notion REST client (pagination, 429 retry), injectable fetch
src/notion/mapping.js             pure Notion -> Gladys mapping (dates, time zones, properties, windows)
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget handlers (manifest `widgets`)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults), account normalization
gladys-assistant-integration.json manifest: type calendar, config_schema, account_schema, capabilities
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and test/helpers/fakeNotion.js
.github/scripts/changelog.mjs     rolls CHANGELOG.md at release, tested in test/changelog.test.js
```

## Rules

- **Ids are forever and user-scoped.** Calendar and event external ids are
  `gladys.externalId(`${userSelector}:${notionId}`)`: the Notion data source
  id for a calendar, the Notion page id for an event. Never derive them from a
  name. The same goes for every key users store: manifest `config_schema`,
  `account_schema`, `actions`, widget, widget setting and scene keys.
- **Privacy.** Calendars are personal: each user syncs with their own token
  (`account_schema`, never `config_schema`). A pushed calendar starts private;
  widgets and scenes only read the calendars their owner `shared`, like the
  core. Never fire a scene event for a private calendar, never log a token or
  an event title at `info` level or above.
- **The core's rules.** Skip a `sync: false` calendar (403). Every push uses a
  window, ≤ 500 events per request (`splitWindow`), every pushed event must
  overlap its window. ≤ 50 calendars per user, 30 calendar writes per minute
  per integration. Never fire `event_created` as a consequence of a scene
  action (`selfCreated`): a scene bound to it would loop.
- **The container rootfs is read-only.** Write only under `/data`. The sync
  state is in memory and rebuilt from Notion at every start.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects
  `{ "en": ..., "fr": ..., "de": ..., "es": ... }`:
  `label`, `description` and `placeholder` alike. The catalog `description`
  holds 10 to 100 characters per language. `type: "calendar"` and
  `account_schema` need `gladys_version >= 5.2.0`. The manifest is excluded
  from Prettier (the Release workflow rewrites it with `jq`).
  `test/manifest.test.js` ties the manifest to the code (defaults, action,
  scene and widget handlers, triggers fired): change both sides together.
- **User-facing text** exists in English, French, German and Spanish
  (`en`, `fr`, `de`, `es`): action messages, widget texts, manifest texts, and
  `docs/en.md` / `fr.md` / `de.md` / `es.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: use `FakeNotion` or an injected
  `fetch`.
