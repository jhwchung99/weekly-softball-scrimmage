<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Architecture

A Google Sheet is the database, and the app is shaped around its limits: the
60-reads-a-minute budget, columns mapped by position, the mutation lock living
in the flows. Read `docs/agents/architecture.md` before changing a route, a
flow, `sheets/`, or anything that reads a tab.

### Live data

Every `tsx --env-file=.env.local` script in `scripts/` talks to production:
there is no local database and no staging sheet, and `preview:emails --send`
puts real mail in a real inbox. `migrate:schedule` and `repair:sessions` take
`-- --dry-run`; run that first and show the output before writing.

### Issue tracker

Issues live as GitHub issues in `jhwchung99/weekly-softball-scrimmage`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Player-facing copy

Wording shown to players or emailed to them follows `docs/voice.md`, which
deliberately diverges from the glossary (ADR-0005). Read it before changing any
user-visible string.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
