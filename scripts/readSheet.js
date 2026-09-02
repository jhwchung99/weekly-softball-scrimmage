import { writeFileSync, mkdirSync } from 'node:fs';
import { getSpreadsheetMeta, getValues } from '../src/sheets/client.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

async function main() {
  console.log(`Reading spreadsheet metadata for ${SPREADSHEET_ID}...\n`);
  const tabs = await getSpreadsheetMeta(SPREADSHEET_ID);

  const snapshot = {};

  for (const tab of tabs) {
    console.log(`Tab: "${tab.title}" (${tab.rowCount} rows x ${tab.columnCount} cols)`);
    const values = await getValues(SPREADSHEET_ID, tab.title);
    snapshot[tab.title] = values;

    const [headers, ...rows] = values;
    console.log(`  Headers: ${headers ? headers.join(', ') : '(empty)'}`);
    console.log(`  Populated rows: ${rows.length}`);
    if (rows.length > 0) {
      console.log(`  First row: ${JSON.stringify(rows[0])}`);
      console.log(`  Last row:  ${JSON.stringify(rows[rows.length - 1])}`);
    }
    console.log('');
  }

  mkdirSync('credentials', { recursive: true });
  writeFileSync('credentials/sheet-snapshot.json', JSON.stringify(snapshot, null, 2));
  console.log('Full snapshot written to credentials/sheet-snapshot.json (gitignored).');
}

main().catch((err) => {
  console.error('Failed to read sheet:', err.message);
  process.exit(1);
});
