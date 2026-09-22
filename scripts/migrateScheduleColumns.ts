/**
 * One-time migration for the 2026-09-22 schedule change.
 *
 * `registrationOpensAt` and `registrationClosesAt` used to hold the timestamp
 * of the cron run that opened or closed a session. They are now *settings* —
 * when the organizer wants registration to open and close — and the stamps
 * moved to the appended `registrationOpenedAt` / `registrationClosedAt`
 * columns. See planner/2026-09-22-multi-session-week-plan.md §2.2.
 *
 * Without this, every existing row's old stamp would be read as an override.
 * That is not merely untidy: a cron that fired an hour late wrote an hour-late
 * timestamp, and reading it as a setting would move that session's schedule an
 * hour late permanently. Blanking both columns restores the derived default,
 * which is exactly the behaviour those rows had before the change.
 *
 * The stamps are moved rather than discarded, so the record of when a week
 * actually opened survives the migration.
 *
 *   npm run migrate:schedule -- --dry-run   (prints, writes nothing)
 *   npm run migrate:schedule
 *
 * Idempotent: a row already migrated has blank settings and is left alone, so
 * running it twice is safe.
 */
import { SPREADSHEET_ID, getRowObjects, updateRow } from '../src/sheets/client';
import { SESSION_HEADERS, parseSessionRow, serializeSessionRow, Session } from '../src/sheets/schema';

const TAB = 'Sessions';
const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const rows = await getRowObjects<ReturnType<typeof serializeSessionRow>>(SPREADSHEET_ID, TAB, SESSION_HEADERS);
  if (rows.length === 0) {
    console.log('No session rows found — nothing to migrate.');
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const session = parseSessionRow(row.data);
    const hadOpen = session.registrationOpensAt !== '';
    const hadClose = session.registrationClosesAt !== '';

    if (!hadOpen && !hadClose) {
      skipped += 1;
      continue;
    }

    const updated: Session = {
      ...session,
      // The old values were stamps. Carry them to the stamp columns, but never
      // overwrite a stamp that is already there — a re-run must not clobber
      // the real record with a blank.
      registrationOpenedAt: session.registrationOpenedAt || session.registrationOpensAt,
      registrationClosedAt: session.registrationClosedAt || session.registrationClosesAt,
      // Blank means "use the derived default", which is what these rows were
      // actually doing before the change.
      registrationOpensAt: '',
      registrationClosesAt: '',
    };

    console.log(
      `${dryRun ? '[dry-run] ' : ''}${session.sessionId}: ` +
        `opensAt ${session.registrationOpensAt || "''"} -> openedAt, ` +
        `closesAt ${session.registrationClosesAt || "''"} -> closedAt`
    );

    if (!dryRun) {
      await updateRow(SPREADSHEET_ID, TAB, row.rowNumber, SESSION_HEADERS, serializeSessionRow(updated));
    }
    migrated += 1;
  }

  console.log(
    `\n${dryRun ? 'Would migrate' : 'Migrated'} ${migrated} row(s); ${skipped} already had a blank window.`
  );
  if (dryRun) console.log('Nothing was written. Re-run without --dry-run to apply.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
