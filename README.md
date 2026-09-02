# Weekly Softball Scrimmage

Scripts that turn a Google Form's response sheet into a running roster,
weekly balanced scrimmage teams, and attendance history — all driven by a
Google service account, no manual copy-pasting.

## How it fits together

Players sign up (or re-confirm) via a Google Form that writes to the
`Responses` tab of a spreadsheet. Returning players can leave the positions
question blank; their most recent non-blank answer is carried forward
everywhere below.

- **`Responses`** — raw form submissions (source of truth, not written to by these scripts)
- **`Positions`** *(live formulas)* — one row per unique player, checkboxes for each position they're comfortable playing, always up to date
- **`<date>`** tabs, e.g. `2026-09-04` *(script-generated)* — that Friday's roster or teams, shaped by turnout (see below)
- **`Attendance History`** *(script-generated)* — weeks-attended per player, with likely-typo names flagged instead of silently merged
- **`Name Aliases`** *(manual)* — `Alias -> Canonical Name` rows you fill in to resolve a flagged typo

## Setup

```sh
npm install
```

You need a Google service account with **Editor** access to the target
spreadsheet:

1. In [Google Cloud Console](https://console.cloud.google.com), enable the Google Sheets API and create a service account.
2. Create a JSON key for it and save it at `credentials/service-account.json` (gitignored — never commit this).
3. Share the spreadsheet with the service account's `...@...iam.gserviceaccount.com` email as an **Editor**.

Every script targets the spreadsheet ID hardcoded as the default in
`SPREADSHEET_ID`; override per-run with the `SPREADSHEET_ID` env var if
needed.

## Scripts

| Command | What it does |
|---|---|
| `npm run read-sheet` | Discovery/debugging: dumps every tab's headers and rows to the console and to `credentials/sheet-snapshot.json` (gitignored). |
| `npm run build-positions-sheet` | Creates/updates the `Positions` tab with live formulas — no re-run needed as new responses come in. |
| `npm run generate-scrimmage -- [YYYY-MM-DD]` | Builds that week's `<date>` tab. Defaults to the upcoming Friday; the date argument must itself be a Friday. |
| `npm run generate-attendance` | Rebuilds the `Attendance History` tab from all of `Responses`. |

### Turnout tiers (`src/sheets/thresholds.js`)

`generate-scrimmage` shapes its output by how many people RSVP'd that week
(a Mon–Fri window ending on the target Friday):

| RSVPs | Output |
|---|---|
| < 7 | Cancelled — lists who RSVP'd, for reference |
| 7–15 | Practice roster only (not enough for a real scrim) |
| 16–17 | Practice roster **and** a no-Rover scrimmage split (8v8+), your call which to run |
| 18+ | Full two-team scrimmage, Rover included |

`generate-attendance` only counts a week toward attendance if it cleared the
7-RSVP minimum — a cancelled week doesn't inflate anyone's count.

### Dummy/test data

`scripts/seedDummyResponses*.js` append synthetic rows to `Responses` for
exercising the above (all using `@dummy.test` emails, so they're easy to
filter out later). Each defaults to a dry run — pass `--write` to actually
append.

## Notes

- `credentials/` is gitignored. Never commit the service account key or the
  `sheet-snapshot.json` discovery dump.
- Unlike `Positions`, the `<date>` and `Attendance History` tabs are written
  as plain values, not live formulas — re-run the corresponding script any
  time RSVPs change and it will fully overwrite that tab (formatting
  included).
