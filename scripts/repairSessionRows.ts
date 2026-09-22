/**
 * Removes session rows written into the wrong columns, and fills in the
 * Sessions header labels.
 *
 * On 2026-09-22 three session rows were appended nineteen columns to the
 * right. `spreadsheets.values.append` treats its range as a hint to *find a
 * table* and writes after it starting at the table's **inferred** first
 * column; with a ragged sheet it inferred column T. Those rows' `sessionId`
 * cell is blank, so `getSession` cannot see them and the dashboard reports
 * "No session ... exists yet" for a session it has just created.
 *
 * The code fix is in `sheets/client.ts` — the append is anchored at A1. This
 * clears the rows already written, and writes the header labels the tab is
 * missing, since a header row stopping short of the data is what made the
 * table's extent inferrable in the first place.
 *
 *   npm run repair:sessions -- --dry-run   (prints, writes nothing)
 *   npm run repair:sessions
 *
 * A row is only touched when its `sessionId` cell is blank **and** it carries
 * an ISO date somewhere to the right of the columns a real row uses, so a
 * legitimate row cannot match.
 */
import { SPREADSHEET_ID, getValues, deleteRow, updateRow, getOrCreateSheet, columnLetter } from '../src/sheets/client';
import { SESSION_HEADERS } from '../src/sheets/schema';

const TAB = 'Sessions';
const dryRun = process.argv.includes('--dry-run');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<void> {
  const rows = await getValues(SPREADSHEET_ID, `${TAB}!A1:Z1000`);
  const header = rows[0] ?? [];

  // 1. The header labels, so the tab's extent is stated rather than inferred.
  const missing = SESSION_HEADERS.filter((h, i) => (header[i] ?? '').trim() !== h);
  if (missing.length === 0) {
    console.log('Header: already complete.');
  } else {
    console.log(`Header: ${dryRun ? 'would write' : 'writing'} ${missing.length} label(s) — ${missing.join(', ')}`);
    if (!dryRun) {
      const labels = Object.fromEntries(SESSION_HEADERS.map((h) => [h, h])) as Record<string, string>;
      await updateRow(SPREADSHEET_ID, TAB, 1, SESSION_HEADERS, labels);
    }
  }

  // 2. The malformed rows, bottom-up so earlier row numbers stay valid.
  const bad: number[] = [];
  rows.forEach((row, i) => {
    if (i === 0) return;
    const sessionId = (row[0] ?? '').trim();
    const shiftedDate = row.slice(16).some((c) => ISO_DATE.test((c ?? '').trim()));
    if (sessionId === '' && shiftedDate) bad.push(i + 1);
  });

  if (bad.length === 0) {
    console.log('Rows: none malformed.');
  } else {
    console.log(`Rows: ${bad.length} malformed (sheet row${bad.length === 1 ? '' : 's'} ${bad.join(', ')})`);
    const tab = await getOrCreateSheet(SPREADSHEET_ID, TAB);
    for (const rowNumber of [...bad].reverse()) {
      const cells = (rows[rowNumber - 1] ?? [])
        .map((c, j) => (c ? `${columnLetter(j + 1)}=${c}` : null))
        .filter(Boolean);
      console.log(`  ${dryRun ? '[dry-run] would delete' : 'deleting'} row ${rowNumber}: ${cells.join('  ')}`);
      if (!dryRun) await deleteRow(SPREADSHEET_ID, tab.sheetId, rowNumber);
    }
  }

  if (dryRun) console.log('\nNothing was written. Re-run without --dry-run to apply.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
