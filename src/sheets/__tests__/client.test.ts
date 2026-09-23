import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SIGNUP_HEADERS } from '../schema';

// client.ts reads SPREADSHEET_ID at module scope, so it has to be set before
// the import below — this also documents that the module no longer falls back
// to a hardcoded production id (see the review, S3).
process.env.SPREADSHEET_ID = 'test-spreadsheet-id';

// So does the service-account key, via loadKey() on the first client call.
// `googleapis` and `google-auth-library` are mocked below, but `node:fs` is
// not, so without this loadKey() reads credentials/service-account.json off
// the real disk — and these tests passed only on a machine that happened to
// have a production key sitting there. CI, with no such file, failed seven of
// them. Setting the inline key exercises the branch production actually uses
// and keeps the suite hermetic.
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
  client_email: 'test@dummy.test.iam.gserviceaccount.com',
  private_key: 'not-a-key',
});

const valuesGet = vi.fn();
const valuesUpdate = vi.fn(async () => ({}));
const valuesAppend = vi.fn(async () => ({}));
const spreadsheetsGet = vi.fn();
vi.mock('googleapis', () => ({
  google: {
    sheets: () => ({ spreadsheets: { get: spreadsheetsGet, values: { get: valuesGet, update: valuesUpdate, append: valuesAppend } } }),
  },
}));
vi.mock('google-auth-library', () => ({ GoogleAuth: class {} }));

const { columnLetter, getRowObjects, updateRow, appendValues, getSpreadsheetMeta, SPREADSHEET_ID, RATE_LIMIT_RETRY_DELAYS_MS } = await import('../client');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('columnLetter', () => {
  it('maps the single-letter range', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
  });

  it('rolls over into two letters correctly', () => {
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(28)).toBe('AB');
    expect(columnLetter(52)).toBe('AZ');
    expect(columnLetter(53)).toBe('BA');
  });

  it('covers the current widest tab (Signups, 24 columns)', () => {
    expect(columnLetter(SIGNUP_HEADERS.length)).toBe('X');
  });
});

describe('SPREADSHEET_ID', () => {
  it('comes from the environment with no hardcoded fallback', () => {
    expect(SPREADSHEET_ID).toBe('test-spreadsheet-id');
  });
});

/**
 * getRowObjects maps sheet columns to field names by POSITION — it never reads
 * the header row. The *_HEADERS arrays therefore *are* the physical column
 * layout, and any drift between them and the sheet silently writes data into
 * the wrong fields with no error. These tests pin that contract down;
 */
describe('getRowObjects positional mapping', () => {
  const HEADERS = ['id', 'name', 'status'] as const;

  it('maps each column to the header at the same index', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['1', 'Ann', 'confirmed']] } });

    const rows = await getRowObjects<Record<(typeof HEADERS)[number], string>>('sheet', 'Tab', HEADERS);

    expect(rows).toEqual([{ rowNumber: 2, data: { id: '1', name: 'Ann', status: 'confirmed' } }]);
  });

  it('requests exactly the header-width range, starting below the header row', async () => {
    valuesGet.mockResolvedValue({ data: { values: [] } });

    await getRowObjects<Record<(typeof HEADERS)[number], string>>('sheet', 'Tab', HEADERS);

    expect(valuesGet).toHaveBeenCalledWith({ spreadsheetId: 'sheet', range: 'Tab!A2:C' });
  });

  it('numbers rows from 2, so rowNumber points at the real sheet row', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['1', 'Ann', 'x'], ['2', 'Bo', 'y']] } });

    const rows = await getRowObjects<Record<(typeof HEADERS)[number], string>>('sheet', 'Tab', HEADERS);

    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  it('pads short rows to empty strings rather than undefined', async () => {
    // Sheets truncates trailing empty cells, so a row can come back short.
    valuesGet.mockResolvedValue({ data: { values: [['1']] } });

    const rows = await getRowObjects<Record<(typeof HEADERS)[number], string>>('sheet', 'Tab', HEADERS);

    expect(rows[0].data).toEqual({ id: '1', name: '', status: '' });
  });

  it('skips entirely blank rows', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['1', 'Ann', 'x'], ['', '', ''], ['2', 'Bo', 'y']] } });

    const rows = await getRowObjects<Record<(typeof HEADERS)[number], string>>('sheet', 'Tab', HEADERS);

    expect(rows).toHaveLength(2);
    expect(rows[1].rowNumber).toBe(4); // the blank row still occupies its row number
  });
});

describe('updateRow', () => {
  it('writes the header-ordered values to that row, RAW so nothing becomes a formula', async () => {
    await updateRow('sheet', 'Tab', 5, ['id', 'name'] as const, { id: '1', name: '=1+1' });

    expect(valuesUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet',
      range: 'Tab!A5:B5',
      valueInputOption: 'RAW',
      requestBody: { values: [['1', '=1+1']] },
    });
  });

  it('substitutes empty strings for missing fields instead of writing undefined', async () => {
    await updateRow('sheet', 'Tab', 2, ['id', 'name'] as const, { id: '1' } as { id: string; name: string });

    expect(valuesUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { values: [['1', '']] } }));
  });
});

/**
 * The retry that outlasts an exhausted quota.
 *
 * Its comment claimed to cover "429/rateLimitExceeded", but the code checked
 * only the status. Sheets returns **403** with reason `rateLimitExceeded` for
 * the per-user per-minute quota — the limit this app is most likely to hit,
 * since one service account carries all its traffic — so those bypassed it.
 */
describe('rate-limit retry', () => {
  const rows = [['2099-01-01']];
  const ok = { data: { values: rows } };

  /**
   * Runs the read past its backoff waits without spending them.
   *
   * The settling is separated from the awaiting on purpose. Advancing the
   * timers yields, so a read that rejects during it rejects while nothing is
   * listening — Node reports that as an unhandled rejection even though the
   * next line awaits it. Attaching the handler first makes the failure cases
   * observable rather than merely awaited.
   */
  async function read() {
    vi.useFakeTimers();
    try {
      const settled = getRowObjects('sheet', 'Sessions', ['sessionId'] as const).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      await vi.runAllTimersAsync();

      const result = await settled;
      if ('error' in result) throw result.error;
      return result.value;
    } finally {
      vi.useRealTimers();
    }
  }

  it('retries a 429 and returns the answer the second time', async () => {
    valuesGet.mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce(ok);

    expect(await read()).toHaveLength(1);
    expect(valuesGet).toHaveBeenCalledTimes(2);
  });

  it('retries a 403 that names the per-minute quota', async () => {
    valuesGet
      .mockRejectedValueOnce({ status: 403, errors: [{ reason: 'rateLimitExceeded' }] })
      .mockResolvedValueOnce(ok);

    expect(await read()).toHaveLength(1);
    expect(valuesGet).toHaveBeenCalledTimes(2);
  });

  it('reads the reason out of the nested response shape too', async () => {
    valuesGet
      .mockRejectedValueOnce({
        code: 403,
        response: { data: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } },
      })
      .mockResolvedValueOnce(ok);

    expect(await read()).toHaveLength(1);
  });

  it('does not retry a 403 that means "no access to this spreadsheet"', async () => {
    // A permission error will fail identically in seven seconds' time, so
    // waiting only delays the message.
    valuesGet.mockRejectedValue({ status: 403, errors: [{ reason: 'forbidden' }] });

    await expect(read()).rejects.toMatchObject({ status: 403 });
    expect(valuesGet).toHaveBeenCalledTimes(1);
  });

  it('gives up after the delays are spent rather than retrying forever', async () => {
    valuesGet.mockRejectedValue({ status: 429 });

    await expect(read()).rejects.toMatchObject({ status: 429 });
    expect(valuesGet).toHaveBeenCalledTimes(RATE_LIMIT_RETRY_DELAYS_MS.length + 1);
  });
});

describe('appendValues', () => {
  /**
   * The bug this locks down cost three session rows on 2026-09-22.
   *
   * `values.append` does not write at the range it is given: it searches that
   * range for a table and writes after it, **starting at the table's first
   * column**, which it infers. Call sites passed `Sessions!A:V`, Sheets
   * inferred the table as beginning at column T, and three rows were written
   * nineteen columns to the right — `sessionId` into `practicePollThreshold`,
   * `gameDate` into `registrationOpenedAt`. Their real `sessionId` cell was
   * blank, so every lookup missed them and the dashboard reported "No session
   * ... exists yet" for a session it had just created.
   *
   * Anchoring at A1 states where the table starts rather than leaving it to be
   * guessed.
   */
  it('anchors the append at A1 rather than an open column range', async () => {
    await appendValues('sheet', 'Sessions', [['a', 'b']]);

    expect(valuesAppend).toHaveBeenCalledWith(expect.objectContaining({ range: 'Sessions!A1' }));
  });

  it('writes RAW, so a leading "=" never becomes a live formula', async () => {
    await appendValues('sheet', 'Sessions', [['=1+1']]);

    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [['=1+1']] } })
    );
  });

  it('does nothing surprising with an empty batch', async () => {
    await appendValues('sheet', 'Sessions', []);

    expect(valuesAppend).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { values: [] } }));
  });
});

describe('getSpreadsheetMeta', () => {
  // A missing id used to read as 0, which is normally the first tab, so
  // deleteSignup would have removed row N of Sessions instead of Signups.
  it('refuses a tab with no id rather than guessing the first tab', async () => {
    spreadsheetsGet.mockResolvedValueOnce({ data: { sheets: [{ properties: { title: 'Signups' } }] } });

    await expect(getSpreadsheetMeta('sheet')).rejects.toThrow(/Signups.*no sheet id/);
  });

  it('keeps a real id of 0', async () => {
    spreadsheetsGet.mockResolvedValueOnce({ data: { sheets: [{ properties: { title: 'Sessions', sheetId: 0 } }] } });

    await expect(getSpreadsheetMeta('sheet')).resolves.toMatchObject([{ title: 'Sessions', sheetId: 0 }]);
  });
});
