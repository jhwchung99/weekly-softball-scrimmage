# How this app is put together

The parts you cannot see from one file. `CONTEXT.md` is the glossary and
`docs/adr/` holds the decisions; this is the shape they sit in.

## A spreadsheet is the database

`src/sheets/` is the repository layer over one Google Sheet. Three things
follow from that and none of them are visible locally:

**Columns map by position.** `getRowObjects` never reads the header row, so the
`*_HEADERS` arrays in `sheets/schema.ts` *are* the column layout. Inserting or
reordering a field shifts every field after it in every existing row, silently.
New fields go on the end, and `npm run verify:schema` checks the sheet still
agrees.

**Every read is a whole-tab read.** There is no query language and no
row-level fetch. `listSignupsForSession` reads the entire Signups tab and
filters in memory, which is why serving ten sessions costs the same as one.

**Appends are anchored.** `appendValues` takes a tab name and builds `<tab>!A1`
itself, because `values.append` infers where a table starts and once inferred
it wrong by nineteen columns (see its comment). Pass the tab, never a range.

## The read budget is the binding constraint

All Sheets traffic runs through one service account: **60 reads per minute for
the whole app**, spent hardest when registration opens and everyone arrives at
once. Three patterns protect it, and each is easy to undo by accident:

- `/api/home` is a **view-model endpoint**, not a resource. It answers the
  whole homepage in three reads. Its doc comment names the trap: reaching for
  `listSignupsForSession` in a loop turns one page load into 1 + 2N.
- `lib/currentWeek.ts` caches the session list briefly and **collapses
  concurrent misses onto one in-flight read**, so twenty people refreshing at
  9am cost one read.
- `listSignupsForSessions` groups one whole-tab read by session id.

Read paths cache; mutations always read fresh, because a capacity check against
a stale row oversubscribes a session.

## Route, flow, repository

Routes validate and project. **Flows** (`lib/*Flow.ts`) own the business rules
and the mutation lock. Repositories (`sheets/*`) do I/O.

Routes read repositories directly, but every mutation goes through a flow,
because **the flow acquires the lock, not the caller** (ADR-0001) — two callers
once forgot, and one of them could oversubscribe a session. The lock is
reentrant, since flows call each other.

Validation runs **above** the lock: a request that will 400 should not queue
behind every other write to find that out.

## Phase is the gate; nothing runs on a schedule

`lib/sessionPhase.ts` computes `before | open | closed | locked | played` from
the session's schedule, on the server (ADR-0003), because the same comparison
in a browser made the answer depend on the viewer's clock.

**The phase alone decides whether signups are accepted** (ADR-0009). The stored
`status` only matters when it is `cancelled`; `open` and `closed` are left over
from GitHub Actions crons that used to flip them, and routinely failed to. The
dashboard's Open and Close buttons move the window's edge to now instead.

Nothing in the app runs on a timer. Anything that has to happen at a time is
either derived from the clock when asked, or a button the organizer presses,
watched for by `weekWatchdog` off ordinary page traffic.

`getWeeklyMilestones` in `lib/time.ts` is the only place milestone arithmetic
happens. Everything reads its answer, which is what lets a session override its
own registration window and roster lock (ADR-0006, ADR-0008) without any
consumer knowing overrides exist. The league runs on Eastern time; never the
server's zone, never the viewer's.

## `sessionId` is the game date

One session per calendar date, so the ISO date doubles as the key. Rescheduling
therefore **rekeys the row** and cascades every signup's `sessionId`
(`adminRescheduleSession`), and any console holding the old id has to follow it.

## One module decides what reaches the client

`lib/views.ts` projects sheet rows into the shapes routes send (ADR-0002). A
test asserts the exact field allowlist, so adding a field to a view is a
deliberate act and a leak cannot return one key at a time.

## Decisions live in pure modules

`adminConsole`, `homeConsole`, `adminAgenda` and `sessionSummary` hold what the
pages *decide* — which request an action makes, what still needs doing, how a
schedule reads as a sentence. None import React, touch the network or the DOM,
so behaviour is checked without rendering. Pages hold state and draw.

## Commands worth knowing

`npm run` lists them. Two things it does not tell you:

- A single test file: `npx vitest run src/lib/__tests__/time.test.ts`.
- **Every `tsx --env-file=.env.local` script talks to production.** There is no
  local database and no staging sheet.
  - Writes rows: `migrate:schedule`, `repair:sessions`, `setup:sheets`,
    `seed:dummy`. The first two take `-- --dry-run`, which prints and writes
    nothing; run that first.
  - Reads only: `verify:schema`.
  - Sends real email: `preview:emails`, but only with `--send`, and it refuses
    any recipient other than `GMAIL_SENDER_EMAIL`. Without the flag it prints
    what would go.
