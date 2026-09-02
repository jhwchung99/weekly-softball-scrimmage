import { appendValues } from '../src/sheets/client.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

const DUMMY_EMAIL_DOMAIN = 'dummy.test';

// Week of 9/14-9/18 (the Friday after next): 16 RSVPs, landing exactly on
// the new MIN_FOR_SCRIMMAGE boundary, to verify the 16-17 "Practice OR
// no-Rover scrimmage" tier still works after the threshold change.
const ROWS = [
  ['Brianna Lee', 'Female', 29, 'Yes', '', '9/14/2026 8:00:00'],
  ['Carlos Nguyen', 'Male', 31, 'No', '', '9/14/2026 8:15:00'],
  ['Evan Brooks', 'Male', 22, 'Yes', '', '9/14/2026 18:00:00'],
  ['Fiona Park', 'Female', 33, 'No', '', '9/15/2026 9:00:00'],
  ['Hannah Ortiz', 'Female', 30, 'Yes', '', '9/15/2026 9:15:00'],
  ['Ian Chen', 'Male', 28, 'Yes', '', '9/15/2026 20:00:00'],
  ['Julia Moreno', 'Female', 25, 'No', '', '9/16/2026 10:00:00'],
  ['Liam O\'Brien', 'Male', 32, 'Yes', '', '9/16/2026 10:15:00'],
  ['Maya Patel', 'Female', 23, 'No', '', '9/16/2026 19:00:00'],
  ['Olivia Grant', 'Female', 27, 'Yes', '', '9/17/2026 8:00:00'],
  ['Peter Zhang', 'Male', 34, 'No', '', '9/17/2026 8:15:00'],
  ['Ryan Coleman', 'Male', 30, 'Yes', '', '9/17/2026 20:00:00'],
  ['Zara Ahmed', 'Female', 24, 'Yes', 'Catcher, SS', '9/17/2026 20:15:00'],
  ['Aaron Blake', 'Male', 27, 'No', '2B, 3B', '9/18/2026 8:00:00'],
  ['Bella Cruz', 'Female', 22, 'Yes', 'Outfield, Rover', '9/18/2026 8:15:00'],
  ['Diego Fox', 'Male', 29, 'Yes', 'Anything', '9/18/2026 8:30:00'],
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
