import { SPREADSHEET_ID, getOrCreateSheet, getSheetsClient, columnLetter } from '../src/sheets/client';
import { SESSION_HEADERS, SIGNUP_HEADERS, PLAYER_HEADERS, ADMIN_HEADERS, FEEDBACK_HEADERS } from '../src/sheets/schema';

async function ensureTabWithHeaders(tabName: string, headers: readonly string[]): Promise<void> {
  const tab = await getOrCreateSheet(SPREADSHEET_ID, tabName);
  const sheets = await getSheetsClient();

  // Only write headers if the row is empty, so re-running this is safe and
  // never clobbers real data.
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:1`,
  });

  const existing = data.values?.[0] ?? [];

  if (existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[...headers]] },
    });
    console.log(`Created "${tabName}" (sheetId ${tab.sheetId}) with headers: ${headers.join(', ')}`);
    return;
  }

  // Columns added to the end of a HEADERS array leave their label blank here,
  // because the original version of this script only ever wrote into an empty
  // row 1. Fill just those trailing cells: existing labels are never touched,
  // so a header someone renamed by hand still shows up in verify:schema rather
  // than being silently overwritten.
  const missing = headers.slice(existing.length);
  if (missing.length === 0) {
    console.log(`"${tabName}" already has a header row — left untouched.`);
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!${columnLetter(existing.length + 1)}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [missing] },
  });
  console.log(`"${tabName}": added ${missing.length} missing header(s): ${missing.join(', ')}`);
}

async function main() {
  await ensureTabWithHeaders('Sessions', SESSION_HEADERS);
  await ensureTabWithHeaders('Signups', SIGNUP_HEADERS);
  await ensureTabWithHeaders('Players', PLAYER_HEADERS);
  await ensureTabWithHeaders('Admins', ADMIN_HEADERS);
  await ensureTabWithHeaders('Feedback', FEEDBACK_HEADERS);
  console.log(`\nDone: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
}

main().catch((err) => {
  console.error('Failed to create data tabs:', err.message);
  process.exit(1);
});
