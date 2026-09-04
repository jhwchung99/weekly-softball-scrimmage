import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { google, sheets_v4 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'credentials/service-account.json';

export const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1KFLSMxqMcEa8z0kB8XIIrwr5H78GnP9n9NpbVUEI1UI';

function loadKey(): Record<string, unknown> {
  // Production (Vercel): the key is set as a GOOGLE_SERVICE_ACCOUNT_KEY env
  // var (the raw JSON key file's contents, as a single-line string) —
  // there's no credentials/service-account.json file on Vercel at all,
  // since it's gitignored and never deployed.
  const inlineKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (inlineKey) {
    try {
      return JSON.parse(inlineKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY is set but isn't valid JSON. (${message})`);
    }
  }

  // Local dev fallback: read the gitignored key file. Intentionally not
  // statically traceable (see the turbopackIgnore comment) — this branch
  // never runs in production, where GOOGLE_SERVICE_ACCOUNT_KEY is set and
  // the code above returns before reaching this file read at all.
  try {
    return JSON.parse(readFileSync(/* turbopackIgnore: true */ KEY_PATH, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read service account key at "${KEY_PATH}", and GOOGLE_SERVICE_ACCOUNT_KEY isn't set. ` +
        `For local dev, set GOOGLE_APPLICATION_CREDENTIALS or place the key at credentials/service-account.json. ` +
        `For production, set GOOGLE_SERVICE_ACCOUNT_KEY to the key file's JSON contents. ` +
        `(${message})`
    );
  }
}

let sheetsClient: sheets_v4.Sheets | undefined;

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;

  const credentials = loadKey();
  const auth = new GoogleAuth({ credentials, scopes: SCOPES });
  sheetsClient = google.sheets({ version: 'v4', auth: auth as unknown as sheets_v4.Options['auth'] });
  return sheetsClient;
}

export interface SheetTab {
  title: string;
  sheetId: number;
  rowCount?: number | null;
  columnCount?: number | null;
}

export async function getSpreadsheetMeta(spreadsheetId: string): Promise<SheetTab[]> {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  return (data.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? '',
    sheetId: s.properties?.sheetId ?? 0,
    rowCount: s.properties?.gridProperties?.rowCount,
    columnCount: s.properties?.gridProperties?.columnCount,
  }));
}

export async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (data.values as string[][]) || [];
}

export async function appendValues(
  spreadsheetId: string,
  range: string,
  rows: (string | number | boolean)[][]
): Promise<void> {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    // RAW, not USER_ENTERED — values are stored literally, never parsed
    // as formulas. Never change this back: user-supplied fields (names,
    // etc.) flow straight into these rows, and USER_ENTERED lets a
    // leading "=" turn a cell into a live formula. See the 2026-09-04
    // security review / planner/2026-09-04-security-hardening-plan.md.
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

export async function getOrCreateSheet(spreadsheetId: string, title: string): Promise<SheetTab> {
  const sheets = await getSheetsClient();
  const tabs = await getSpreadsheetMeta(spreadsheetId);
  const existing = tabs.find((t) => t.title === title);
  if (existing) return existing;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const props = res.data.replies?.[0]?.addSheet?.properties;
  return { title: props?.title ?? title, sheetId: props?.sheetId ?? 0 };
}

// --- Generic row-object operations, added for Step 3 (a real typed data
// layer) — the old script-era client only ever did whole-column reads and
// appends. These let a repository module (sessions.ts, signups.ts, ...)
// work in terms of "rows as objects keyed by header" instead of raw arrays.

/** 1-indexed spreadsheet column letter for a 1-indexed column number. */
export function columnLetter(n: number): string {
  let s = '';
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

export interface SheetRow<T> {
  /** 1-indexed row number in the actual sheet (header is row 1, so data starts at 2). */
  rowNumber: number;
  data: T;
}

/**
 * Reads every data row (below the header) of `tab` and maps each one to an
 * object keyed by `headers`, in order. Filtering happens application-side
 * (`.filter()` on the result) — the Sheets API has no server-side WHERE
 * equivalent, which is fine at this scale (a weekly pickup game's signups
 * are never more than a few hundred rows).
 */
export async function getRowObjects<T extends Record<string, unknown>>(
  spreadsheetId: string,
  tab: string,
  headers: readonly (keyof T & string)[]
): Promise<SheetRow<T>[]> {
  const lastCol = columnLetter(headers.length);
  const rows = await getValues(spreadsheetId, `${tab}!A2:${lastCol}`);
  return rows
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ''))
    .map((row, i) => {
      const data = {} as T;
      headers.forEach((header, idx) => {
        (data as Record<string, unknown>)[header] = row[idx] ?? '';
      });
      return { rowNumber: i + 2, data };
    });
}

/** Overwrites one existing row in place, given its 1-indexed row number. */
export async function updateRow<T extends Record<string, unknown>>(
  spreadsheetId: string,
  tab: string,
  rowNumber: number,
  headers: readonly (keyof T & string)[],
  data: T
): Promise<void> {
  const sheets = await getSheetsClient();
  const values = headers.map((header) => {
    const value = data[header];
    return value === undefined || value === null ? '' : value;
  });
  const lastCol = columnLetter(headers.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A${rowNumber}:${lastCol}${rowNumber}`,
    // RAW, not USER_ENTERED — see the comment in appendValues above.
    valueInputOption: 'RAW',
    requestBody: { values: [values as (string | number | boolean)[]] },
  });
}

/**
 * Physically removes a row (shifts everything below it up). Needs the
 * tab's numeric sheetId (from getOrCreateSheet/getSpreadsheetMeta), not
 * its name. Reserved for admin "remove a signup" style actions — normal
 * cancellation should go through updateRow to set status, not this.
 */
export async function deleteRow(spreadsheetId: string, sheetId: number, rowNumber: number): Promise<void> {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}
