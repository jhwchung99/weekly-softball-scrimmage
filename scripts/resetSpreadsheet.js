import { getSheetsClient, getSpreadsheetMeta } from '../src/sheets/client.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

const RESPONSES_TAB = 'Responses';

async function main() {
  const write = process.argv.includes('--write');
  const sheets = await getSheetsClient();
  const tabs = await getSpreadsheetMeta(SPREADSHEET_ID);

  const responses = tabs.find((t) => t.title === RESPONSES_TAB);
  if (!responses) throw new Error(`Could not find a "${RESPONSES_TAB}" tab.`);

  const toDelete = tabs.filter((t) => t.title !== RESPONSES_TAB);

  console.log(`${write ? 'Will delete' : 'DRY RUN — would delete'} ${toDelete.length} tab(s):`);
  for (const t of toDelete) console.log(`  - ${t.title}`);
  console.log(`\n${write ? 'Will clear' : 'DRY RUN — would clear'} all data rows in "${RESPONSES_TAB}" (header row kept).`);

  if (!write) {
    console.log('\nRe-run with --write to actually perform these changes.');
    return;
  }

  if (toDelete.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: toDelete.map((t) => ({ deleteSheet: { sheetId: t.sheetId } })),
      },
    });
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${RESPONSES_TAB}!A2:Z`,
  });

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Failed to reset spreadsheet:', err.message);
  process.exit(1);
});
