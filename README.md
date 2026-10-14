# Notion Calendar for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that
syncs the Notion databases shown in
[Notion Calendar](https://www.notion.com/product/calendar) into the Gladys
calendars — built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

| Surface               | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| Calendar provider     | Every Notion database with a date property becomes a per-user Gladys calendar      |
| Scene trigger         | `event_created` — a dated page appeared in a shared calendar (filter: calendar)    |
| Scene trigger         | `sync_failed` — an account stopped syncing (revoked token, unshared database)      |
| Scene action          | `sync_now` — sync now, outputs the counts                                          |
| Scene action          | `create_event` — create a page in the Notion database of a shared calendar         |
| Scene action          | `get_next_event` — the next event of the shared calendars, for the following steps |
| Dashboard widget      | `upcoming_events` — the next events, with their Notion link                        |
| Dashboard widget      | `agenda_summary` — counts for 24 h / 7 days, next event, sync health               |
| Configuration buttons | `test_connection`, `sync_now`                                                      |

The calendars also feed the core's own features: the calendar view, the
`calendar.event-is-coming` trigger and the assistant.

**Tags:** `type: "calendar"`, `transports: ["cloud"]` (Notion is only reachable
through its cloud API), category `services`. Requires **Gladys ≥ 5.2.0**.

## How it works

```
index.js            new GladysIntegration() + registerHandlers() + connect()
src/app.js          handlers: actions, scene actions, widgets, account/config updates, lifecycle
src/sync.js         per user: resolve data sources -> publishCalendars -> query pages -> publishCalendarEvents
src/notion/         REST client (pinned Notion-Version, pagination, 429 retry) + pure mapping
```

At every connection, every `sync_interval` minutes, on every account update
and on demand, for each user who enabled the integration:

1. read their data sources (the listed databases, or every one shared with
   their Notion integration) and keep those with a date property;
2. upsert them as calendars (`ext:<selector>:<user>:<data source id>`) and
   delete the calendars of databases no longer reachable;
3. for each calendar the user did not turn off, query the pages dated within
   `[today − past_days, today + future_days]` and push them with that window,
   so pages deleted in Notion are pruned (split into sub-windows beyond 500
   events);
4. fire `event_created` for the pages that appeared in a shared calendar since
   the previous sync.

Widgets and scenes read the in-memory result, restricted to the calendars
their owner shared with the household.

## Development

```bash
npm install
npm test               # node --test (fake Gladys from the SDK + fake Notion, no network)
npm run lint           # ESLint
npm run format:check   # Prettier
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="notion-calendar" \
LOG_LEVEL=debug \
npm start
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Workflows

| Workflow                                       | Trigger                          | Does                                                                                  |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)           | push on `main`, pull requests    | Prettier, ESLint, tests (Node 24)                                                     |
| [`release.yml`](.github/workflows/release.yml) | Actions → Release → Run workflow | bumps `package.json` + manifest, rolls `CHANGELOG.md`, tags `vX.Y.Z`, calls the build |
| [`build.yml`](.github/workflows/build.yml)     | `v*` tag, manual, called         | multi-arch image (`linux/amd64` + `linux/arm64`) to `ghcr.io` (`:X.Y.Z` + `:latest`)  |

## Publishing

1. Make the repository public and add the GitHub topic
   `gladys-assistant-integration`.
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.
4. Make the `ghcr.io` package public (first release only), so Gladys can pull
   the image.

Turn on **Private vulnerability reporting** in the repository's security
settings: [`SECURITY.md`](SECURITY.md) sends reporters there.

## License

Apache-2.0
