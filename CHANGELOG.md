# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships.

## [Unreleased]

## [0.1.1] - 2026-10-12

### Added

- Notion Calendar integration (Gladys 5.2.0 or later, calendar provider): each
  user enables it with their own Notion integration secret, and every Notion
  database with a date property becomes a Gladys calendar, synced every 15
  minutes by default (interval and window set in the configuration).
- Full-day and timed events, Notion time zones, the event location (`Location`
  / `Lieu` property) and the link to the Notion page.
- Pages deleted or undated in Notion leave Gladys at the next sync; a database
  no longer shared removes its calendar.
- Scene triggers: "Notion event added" (filterable by calendar) and "Notion
  sync failed".
- Scene actions: "Sync Notion calendars", "Add a Notion event" and "Get the
  next Notion event".
- Dashboard widgets: "Notion agenda" (next events) and "Notion summary"
  (counters, next event, sync health). Widgets and scenes only see the
  calendars shared with the household.
- Configuration buttons: "Test the Notion accounts" and "Sync now".
- CI (format, lint, tests, on every push to `main` and every pull request),
  multi-arch image build and UI-driven release workflows.
- `SECURITY.md` and `CLAUDE.md`.

[Unreleased]: https://github.com/quentinlegay/gladys-notion-calendar/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/quentinlegay/gladys-notion-calendar/releases/tag/v0.1.1
