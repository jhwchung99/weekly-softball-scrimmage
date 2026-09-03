import { SPREADSHEET_ID, getOrCreateSheet, getSheetsClient } from '../src/sheets/client';
import { SESSION_HEADERS, SIGNUP_HEADERS, PLAYER_HEADERS } from '../src/sheets/schema';

async function ensureTabWithHeaders(tabName: string, headers: readonly string[]): Promise<void> {
  const tab = await getOrCreateSheet(SPREADSHEET_ID, tabName);
  const sheets = await getSheetsClient();

  // Only write headers if the row is empty, so re-running this is safe and
  // never clobbers real data.
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:1`,
  });

  if (!data.values || data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[...headers]] },
    });
    console.log(`Created "${tabName}" (sheetId ${tab.sheetId}) with headers: ${headers.join(', ')}`);
  } else {
    console.log(`"${tabName}" already has a header row — left untouched.`);
  }
}

async function main() {
  await ensureTabWithHeaders('Sessions', SESSION_HEADERS);
  await ensureTabWithHeaders('Signups', SIGNUP_HEADERS);
  await ensureTabWithHeaders('Players', PLAYER_HEADERS);
  console.log(`\nDone: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
}

main().catch((err) => {
  console.error('Failed to create data tabs:', err.message);
  process.exit(1);
});
