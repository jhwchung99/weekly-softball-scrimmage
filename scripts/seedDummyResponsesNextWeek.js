import { appendValues } from '../src/sheets/client.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

const DUMMY_EMAIL_DOMAIN = 'dummy.test';

// Week of 9/7-9/11 (next Friday's scrimmage): 12 RSVPs, deliberately in the
// 7-17 "low turnout" range to exercise the Practice / no-Rover-scrimmage
// logic. Includes 6 resubmits (blank positions, carried forward from prior
// weeks) and one deliberate near-duplicate — "Josh Chung" vs the existing
// "Joshua Chung" — to give the attendance-history duplicate-flagging
// something real to catch.
const ROWS = [
  ['Alex Rivera', 'Male', 24, 'Yes', '', '9/7/2026 8:00:00'],
  ['Dana Whitfield', 'Female', 27, 'Yes', '', '9/7/2026 8:15:00'],
  ['George Kim', 'Male', 26, 'No', '', '9/7/2026 18:00:00'],
  ['Karen Diaz', 'Female', 24, 'Yes', '', '9/8/2026 9:00:00'],
  ['Noah Silva', 'Male', 29, 'Yes', '', '9/8/2026 9:15:00'],
  ['Quinn Foster', 'Female', 21, 'Yes', '', '9/8/2026 20:00:00'],
  ['Josh Chung', 'Male', 26, 'Yes', 'Rover, Outfield', '9/9/2026 10:00:00'],
  ['Uma Torres', 'Female', 25, 'No', 'Catcher, 2B', '9/9/2026 10:15:00'],
  ['Victor Lima', 'Male', 31, 'Yes', '1B, 3B', '9/9/2026 19:00:00'],
  ['Wendy Osei', 'Female', 28, 'Yes', 'SS, Outfield', '9/10/2026 8:00:00'],
  ['Xavier Brooks', 'Male', 23, 'No', 'Anything', '9/10/2026 8:15:00'],
  ['Yasmin Cole', 'Female', 30, 'Yes', 'Catcher, Rover', '9/10/2026 20:00:00'],
];

function slug(name) {
  return name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
}

function toFormRow([name, gender, age, membership, positions, timestamp]) {
  const email = `${slug(name)}@${DUMMY_EMAIL_DOMAIN}`;
  return [timestamp, name, gender, age, email, membership, positions];
}

async function main() {
  const write = process.argv.includes('--write');
  const formRows = ROWS.map(toFormRow);

  console.log(`${write ? 'Writing' : 'DRY RUN — would write'} ${formRows.length} dummy rows to Responses:\n`);
  for (const row of formRows) {
    console.log(`  ${JSON.stringify(row)}`);
  }

  if (!write) {
    console.log('\nRe-run with --write to actually append these rows.');
    return;
  }

  await appendValues(SPREADSHEET_ID, 'Responses!A:G', formRows);
  console.log(`\nAppended ${formRows.length} rows to Responses.`);
}

main().catch((err) => {
  console.error('Failed to seed dummy responses:', err.message);
  process.exit(1);
});
