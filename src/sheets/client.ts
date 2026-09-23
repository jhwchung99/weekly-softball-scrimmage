import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { google, sheets_v4 } from 'googleapis';
import { isRateLimitError } from './rateLimitError';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'credentials/service-account.json';

/**
 * No hardcoded fallback. A default meant any environment that forgot to set
 * this — a preview deploy, a test run, a script — silently read and wrote the
 * live production spreadsheet instead of failing loudly. That is exactly how a
 * unit test ended up hitting production data on 2026-09-05.
 *
 * Deliberately NOT validated at module scope: that would throw during
 * `next build` (which imports route modules) and take down static pages that
 * never touch Sheets at all. Instead getSheetsClient() — which every single
 * Sheets operation in this file goes through — asserts it just before use, so
 * a misconfiguration fails loudly at exactly the right moment and nowhere else.
 */
export const SPREADSHEET_ID = process.env.SPREADSHEET_ID ?? '';

function assertSpreadsheetConfigured(): void {
  if (!SPREADSHEET_ID) {
    throw new Error(
      'SPREADSHEET_ID is not set — refusing to guess a spreadsheet. Set it in .env.local for local dev, ' +
        'and as an environment variable on Vercel for production.'
    );
  }
}

function loadKey(): Record<string, unknown> {
  // Production (Vercel): the key is set as a GOOGLE_SERVICE_ACCOUNT_KEY env
  // var (the raw JSON key file's contents, as a single-line string)
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

// The googleapis client already retries transient failures a few times with a
// short backoff, but that wasn't enough to outlast a genuinely exhausted
// per-minute read-request quota (hit live during 2026-09-04 testing). This
// adds a longer, targeted retry on top of that rather than replacing it.
/** Exported so the lock's TTL can be checked against the worst case it has to
 * cover — see lib/__tests__/lockBudget.test.ts. */
export const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 5000];

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= RATE_LIMIT_RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAYS_MS[attempt]));
    }
  }
}

let sheetsClient: sheets_v4.Sheets | undefined;

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  assertSpreadsheetConfigured();
  if (sheetsClient) return sheetsClient;

  const credentials = loadKey();
  const auth = new GoogleAuth({ credentials, scopes: SCOPES });
  sheetsClient = google.sheets({ version: 'v4', auth });
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
  const { data } = await withRateLimitRetry(() => sheets.spreadsheets.get({ spreadsheetId }));
  return (data.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? '',
    sheetId: requireSheetId(s.properties?.sheetId, s.properties?.title),
    rowCount: s.properties?.gridProperties?.rowCount,
    columnCount: s.properties?.gridProperties?.columnCount,
  }));
}

export async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const { data } = await withRateLimitRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range }));
  return (data.values as string[][]) || [];
}

/**
 * Appends rows to the bottom of a tab.
 *
 * Takes the **tab name**, not a range, and that is the whole point.
 *
 * `spreadsheets.values.append` does not write at the range it is given. It
 * uses that range to *search for a table*, then writes after the table's last
 * row **starting at the table's first column** — which it infers. Callers here
 * used to pass `Sessions!A:V`, and on 2026-09-22 Sheets inferred the table as
 * starting at column T and wrote three session rows nineteen columns to the
 * right: `sessionId` landed in `practicePollThreshold`, `gameDate` in
 * `registrationOpenedAt`, and the rows were invisible to every lookup because
 * their real `sessionId` cell was blank.
 *
 * What made it inferrable was ragged data — the header row stops at column P
 * while data rows reach V — and the trigger was the Sessions tab growing two
 * columns, which widened the range being searched. Any tab could have hit it.
 *
 * Anchoring at `A1` states where the table begins instead of leaving it to be
 * guessed, and the range is built here so no call site can reintroduce the
 * ambiguity. See planner/2026-09-22-multi-session-week-plan.md.
 */
export async function appendValues(
  spreadsheetId: string,
  tab: string,
  rows: (string | number | boolean)[][]
): Promise<void> {
  const sheets = await getSheetsClient();
  await withRateLimitRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A1`,
      // RAW, not USER_ENTERED — values are stored literally, never parsed
      // as formulas. Never change this back: user-supplied fields (names,
      // etc.) flow straight into these rows, and USER_ENTERED lets a
      // leading "=" turn a cell into a live formula. See the 2026-09-04
      // security review
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    })
  );
}

export async function getOrCreateSheet(spreadsheetId: string, title: string): Promise<SheetTab> {
  const sheets = await getSheetsClient();
  const tabs = await getSpreadsheetMeta(spreadsheetId);
  const existing = tabs.find((t) => t.title === title);
  if (existing) return existing;

  const res = await withRateLimitRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    })
  );
  const props = res.data.replies?.[0]?.addSheet?.properties;
  return { title: props?.title ?? title, sheetId: requireSheetId(props?.sheetId, title) };
}

/**
 * A tab's numeric id, or a throw. It used to fall back to 0, which is normally
 * the spreadsheet's first tab, so deleteRow aimed at Signups would have removed
 * a row of whatever tab came first.
 */
function requireSheetId(sheetId: number | null | undefined, title: string | null | undefined): number {
  if (sheetId === null || sheetId === undefined) {
    throw new Error(`Sheets returned tab "${title ?? '?'}" with no sheet id.`);
  }
  return sheetId;
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
  // rowNumber is assigned from each row's position in the RAW response, before
  // blank rows are dropped. Numbering after the filter shifted every row below
  // a blank one up by one, and since rowNumber is what updateRow/deleteRow
  // target, a single cleared-but-not-deleted row would make every subsequent
  // write land on the wrong person.
  return rows
    .map((row, i) => ({ row, rowNumber: i + 2 }))
    .filter(({ row }) => row.some((cell) => cell !== undefined && cell !== ''))
    .map(({ row, rowNumber }) => {
      const data = {} as T;
      headers.forEach((header, idx) => {
        (data as Record<string, unknown>)[header] = row[idx] ?? '';
      });
      return { rowNumber, data };
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
  await withRateLimitRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A${rowNumber}:${lastCol}${rowNumber}`,
      // RAW, not USER_ENTERED — see the comment in appendValues above.
      valueInputOption: 'RAW',
      requestBody: { values: [values as (string | number | boolean)[]] },
    })
  );
}

export interface RangeUpdate {
  range: string;
  values: (string | number | boolean)[];
}

/**
 * Applies several single-row updates in one Sheets API call instead of
 * one call per row — each call is its own quota unit, so a caller that
 * already knows it's about to write several related rows (e.g. pairing
 * two signups together, or declining several other pending requests at
 * once) should batch them here rather than looping updateRow.
 */
export async function batchUpdateRows(spreadsheetId: string, updates: RangeUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const sheets = await getSheetsClient();
  await withRateLimitRetry(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: u.range, values: [u.values] })),
      },
    })
  );
}

/**
 * Physically removes a row (shifts everything below it up). Needs the
 * tab's numeric sheetId (from getOrCreateSheet/getSpreadsheetMeta), not
 * its name. Reserved for admin "remove a signup" style actions — normal
 * cancellation should go through updateRow to set status, not this.
 */
export async function deleteRow(spreadsheetId: string, sheetId: number, rowNumber: number): Promise<void> {
  const sheets = await getSheetsClient();
  await withRateLimitRetry(() =>
    sheets.spreadsheets.batchUpdate({
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
    })
  );
}
