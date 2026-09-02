import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'credentials/service-account.json';

function loadKey() {
  try {
    return JSON.parse(readFileSync(KEY_PATH, 'utf8'));
  } catch (err) {
    throw new Error(
      `Could not read service account key at "${KEY_PATH}". ` +
      `Set GOOGLE_APPLICATION_CREDENTIALS or place the key at credentials/service-account.json. ` +
      `(${err.message})`
    );
  }
}

let sheetsClient;

export async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const credentials = loadKey();
  const auth = new GoogleAuth({ credentials, scopes: SCOPES });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function getSpreadsheetMeta(spreadsheetId) {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  return data.sheets.map((s) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    rowCount: s.properties.gridProperties?.rowCount,
    columnCount: s.properties.gridProperties?.columnCount,
  }));
}

export async function getValues(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return data.values || [];
}

export async function appendValues(spreadsheetId, range, rows) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

export async function getOrCreateSheet(spreadsheetId, title) {
  const sheets = await getSheetsClient();
  const tabs = await getSpreadsheetMeta(spreadsheetId);
  const existing = tabs.find((t) => t.title === title);
  if (existing) return existing;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const props = res.data.replies[0].addSheet.properties;
  return { title: props.title, sheetId: props.sheetId };
}
