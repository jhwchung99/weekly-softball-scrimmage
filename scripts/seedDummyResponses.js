import { appendValues } from '../src/sheets/client.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

// All dummy accounts use @dummy.test (RFC 2606 reserved, non-routable) so
// they're trivially filterable/removable later without touching real rows.
const DUMMY_EMAIL_DOMAIN = 'dummy.test';

// name, gender, age, membership, positions ("" = resubmitting, leave blank),
// timestamp in the same "M/D/YYYY H:MM:SS" format Google Forms writes.
const ROWS = [
  // --- Week of 8/17 (2 weeks ago): initial full submissions ---
  ['Alex Rivera', 'Male', 24, 'Yes', 'Catcher, 1B', '8/17/2026 9:05:00'],
  ['Brianna Lee', 'Female', 29, 'Yes', 'SS, 2B', '8/17/2026 9:12:00'],
  ['Carlos Nguyen', 'Male', 31, 'No', 'Outfield, Rover', '8/18/2026 14:20:00'],
  ['Dana Whitfield', 'Female', 27, 'Yes', '3B, SS', '8/18/2026 14:45:00'],
  ['Evan Brooks', 'Male', 22, 'Yes', 'Anything', '8/19/2026 8:30:00'],
  ['Fiona Park', 'Female', 33, 'No', 'Catcher, Outfield', '8/20/2026 19:00:00'],

  // --- Week of 8/24 (last week): 3 resubmits (blank positions) + 4 new ---
  ['Alex Rivera', 'Male', 24, 'Yes', '', '8/24/2026 9:00:00'],
  ['Brianna Lee', 'Female', 29, 'Yes', '', '8/24/2026 9:10:00'],
  ['Evan Brooks', 'Male', 22, 'Yes', '', '8/25/2026 8:15:00'],
  ['George Kim', 'Male', 26, 'No', '2B, 3B', '8/25/2026 16:40:00'],
  ['Hannah Ortiz', 'Female', 30, 'Yes', 'Outfield, Rover', '8/26/2026 12:00:00'],
  ['Ian Chen', 'Male', 28, 'Yes', 'SS, 1B', '8/27/2026 20:05:00'],
  ['Julia Moreno', 'Female', 25, 'No', 'Anything', '8/28/2026 10:30:00'],

  // --- This week, 8/31-9/4 (this Friday's scrimmage): 7 resubmits + 10 new ---
  ['Carlos Nguyen', 'Male', 31, 'No', '', '8/31/2026 7:45:00'],
  ['Dana Whitfield', 'Female', 27, 'Yes', '', '8/31/2026 8:00:00'],
  ['Fiona Park', 'Female', 33, 'No', '', '8/31/2026 8:10:00'],
  ['George Kim', 'Male', 26, 'No', '', '8/31/2026 18:20:00'],
  ['Hannah Ortiz', 'Female', 30, 'Yes', '', '9/1/2026 9:00:00'],
  ['Ian Chen', 'Male', 28, 'Yes', '', '9/1/2026 9:05:00'],
  ['Julia Moreno', 'Female', 25, 'No', '', '9/1/2026 9:15:00'],
  ['Karen Diaz', 'Female', 24, 'Yes', '1B, 2B', '9/1/2026 12:00:00'],
  ["Liam O'Brien", 'Male', 32, 'Yes', 'Catcher, SS', '9/1/2026 12:10:00'],
  ['Maya Patel', 'Female', 23, 'No', 'Rover, Outfield', '9/1/2026 20:00:00'],
  ['Noah Silva', 'Male', 29, 'Yes', '3B, Anything', '9/1/2026 20:15:00'],
  ['Olivia Grant', 'Female', 27, 'Yes', 'SS, 2B', '9/2/2026 8:00:00'],
  ['Peter Zhang', 'Male', 34, 'No', 'Outfield, 1B', '9/2/2026 8:20:00'],
  ['Quinn Foster', 'Female', 21, 'Yes', 'Catcher, 3B', '9/2/2026 9:00:00'],
  ['Ryan Coleman', 'Male', 30, 'Yes', '2B, SS', '9/2/2026 9:30:00'],
  ['Sofia Martins', 'Female', 26, 'No', 'Catcher, Rover', '9/2/2026 10:00:00'],
  ['Tariq Hassan', 'Male', 35, 'Yes', 'Anything', '9/2/2026 10:15:00'],
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
