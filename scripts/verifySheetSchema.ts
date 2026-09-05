/**
 * Verifies that each tab's physical column layout still matches the
 * `*_HEADERS` arrays in src/sheets/schema.ts.
 *
 * This matters more than it looks: getRowObjects maps columns to fields by
 * POSITION and never reads the header row, so the HEADERS arrays *are* the
 * column layout. If anyone inserts, removes, or reorders a column in the
 * Google Sheets UI — or edits a HEADERS array without migrating the sheet —
 * every field after that point silently shifts, writing (say) memberStatus
 * into the gender column with no error at any layer. It is invisible until
 * someone reads a row and notices the data is nonsense.
 *
 * Run it after any schema change, and any time the sheet is edited by hand:
 *
 *   npm run verify:schema
 *
 * See planner/2026-09-05-code-security-review.md, R1.
 */
import { SPREADSHEET_ID, getValues } from '../src/sheets/client';
import { SESSION_HEADERS, SIGNUP_HEADERS, PLAYER_HEADERS, ADMIN_HEADERS } from '../src/sheets/schema';

const TABS: { tab: string; headers: readonly string[] }[] = [
  { tab: 'Sessions', headers: SESSION_HEADERS },
  { tab: 'Signups', headers: SIGNUP_HEADERS },
  { tab: 'Players', headers: PLAYER_HEADERS },
  { tab: 'Admins', headers: ADMIN_HEADERS },
];

async function verifyTab(tab: string, headers: readonly string[]): Promise<string[]> {
  const [actual = []] = await getValues(SPREADSHEET_ID, `${tab}!A1:1`);
  const problems: string[] = [];

  headers.forEach((expected, i) => {
    const found = (actual[i] ?? '').trim();
    // A blank label is tolerated — the header row is decorative and has
    // historically lagged behind schema additions. A *different* label is not:
    // that means the columns themselves have moved.
    if (found && found !== expected) {
      problems.push(`  column ${String.fromCharCode(65 + i)}: expected "${expected}", sheet says "${found}"`);
    }
  });

  if (actual.length > headers.length) {
    const extra = actual.slice(headers.length).filter((c) => (c ?? '').trim());
    if (extra.length) {
      problems.push(`  ${extra.length} unexpected column(s) beyond the schema: ${extra.join(', ')}`);
    }
  }

  return problems;
}

async function main() {
  let failed = false;

  for (const { tab, headers } of TABS) {
    const problems = await verifyTab(tab, headers);
    if (problems.length) {
      failed = true;
      console.error(`✗ ${tab}\n${problems.join('\n')}`);
    } else {
      console.log(`✓ ${tab} (${headers.length} columns)`);
    }
  }

  if (failed) {
    console.error(
      '\nThe sheet no longer matches src/sheets/schema.ts. Because columns are mapped by position, ' +
        'reads and writes are landing in the wrong fields. Fix the sheet or the schema before using the app.'
    );
    process.exit(1);
  }
  console.log('\nAll tabs match the schema.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
