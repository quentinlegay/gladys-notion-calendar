# Notion Calendar

Bring into Gladys the Notion databases you display in
[Notion Calendar](https://www.notion.com/product/calendar): team planning,
tasks with a due date, editorial calendar, trips… The events show up in the
Gladys calendar view, fire the "An event is coming" reminder, feed the
assistant and two dashboard widgets.

## How it works

```
Notion databases (date property)  ──Notion API──>  this integration  ──>  Gladys calendars
```

Notion Calendar has no public API: it displays the Notion databases that have
a **date** property. The integration reads those same databases through the
Notion API, then:

- each database (data source) with a date property becomes a Gladys
  **calendar**, named after the database;
- each dated page becomes an **event**: its title, its date (all day or
  timed), its Notion link and, when the database has a `Location` / `Lieu` / `Ort` / `Lugar`
  text property, its location.

The sync goes from Notion to Gladys, every 15 minutes by default. A page
deleted, or whose date is cleared, leaves Gladys at the next sync. Only the
**Add a Notion event** scene action writes to Notion.

The Google or Outlook meetings Notion Calendar also displays do not go through
Notion: use the Gladys CalDAV or Google integration for them.

## Setup

### 1. Create a Notion integration (once per person)

1. Open [My Notion integrations](https://www.notion.so/profile/integrations)
   and create an **internal integration** in your workspace.
2. Capabilities: **Read content** is enough. Also tick **Insert content** to
   use the "Add a Notion event" scene action.
3. Copy the integration **secret** (it starts with `ntn_`).
4. On each database to sync, open the **•••** menu → **Connections** and add
   your integration. A database that is not shared stays invisible.

### 2. Integration settings (administrator)

In the **Configuration** tab:

| Setting               | Default | Purpose                                      |
| --------------------- | ------- | -------------------------------------------- |
| Sync interval         | 15 min  | How often Notion is read (5 minutes minimum) |
| Days kept in the past | 30      | Older events are removed from Gladys         |
| Days synced ahead     | 90      | Horizon of the view, reminders and widgets   |

### 3. Enable "My calendars" (each user)

Calendars are personal data: each Gladys user enables the integration for
themselves, with their own Notion secret, in the **My calendars** block of the
integration page.

- **Notion integration secret**: the secret copied at step 1.
- **Databases (optional)**: links or ids of the databases to sync, separated
  by commas. Leave empty to sync every database shared with the integration.
- **Date property (optional)**: name of the property to use when a database
  has several (e.g. `Due`). Empty: the first date property of the database.

The **Test the Notion accounts** button of the Configuration tab tells, for
each user, how many dated databases their secret can read.

### 4. Share the calendars that matter

A synced calendar starts **private**: only its owner sees it. Share it with
the household (**Shared** toggle) to show it on the dashboards, in the scenes
and to the other members. The **Synced** toggle pauses a calendar without
deleting it.

## Scenes

### Triggers

| Trigger                | When                                                        | Variables                                     |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| **Notion event added** | A dated page appears in a shared Notion calendar            | `calendar`, `name`, `start`, `all_day`, `url` |
| **Notion sync failed** | An account stops syncing (revoked token, unshared database) | `user`, `error`                               |

The "Notion event added" trigger can be filtered on the **calendar name** (the
name of the Notion database). It does not fire on the very first sync of an
account, nor for the events created by the scene action below.

The built-in Gladys trigger **An event is coming** works on the shared Notion
calendars too.

### Actions

| Action                        | Fields                               | Outputs                                                      |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| **Sync Notion calendars**     | —                                    | `calendars`, `events`, `success`                             |
| **Add a Notion event**        | calendar, name, start, end, location | `created`, `url`                                             |
| **Get the next Notion event** | calendar (empty: all)                | `found`, `name`, `start`, `minutes_until`, `calendar`, `url` |

- **Start / end**: a date (`2026-10-12`) for an all-day event, or a date-time
  with an offset (`2026-10-12T09:00:00+02:00`). Scene variables are accepted.
- The actions only see the **shared** calendars.

Example: every morning at 7, "Get the next Notion event", then if `found` is
true, have the assistant announce `{{name}}`.

## Widgets

| Widget             | Content                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| **Notion agenda**  | The next events (1 to 8), filterable by calendar, with their Notion link |
| **Notion summary** | Events within 24 h and 7 days, time to the next one, sync health         |

Both widgets offer a **Sync now** button and only show the shared calendars (a
dashboard may hang on a public screen).

## Troubleshooting

- **"Notion refused the token"**: the secret was regenerated or the
  integration deleted. Paste the new secret in My calendars.
- **"A database is not shared"**: a database listed in "Databases" is not
  connected to the integration (••• → Connections), or the link is wrong.
- **A database does not show up**: it has no date property, or it is not
  shared with the integration.
- **An event longer than 90 days overflowing into the period** is not synced:
  only the pages starting at most 90 days before the period are read.
- The integration logs (Supervision tab) detail every sync; the Notion secret
  never appears there.

## Privacy

Each user's Notion secret is kept by Gladys, never shown again in the interface, and only sent to
`api.notion.com`. The integration only reads the databases you explicitly
shared with your Notion integration.
