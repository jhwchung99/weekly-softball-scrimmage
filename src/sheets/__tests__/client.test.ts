import { describe, it, expect, vi, beforeEach } from 'vitest';

// client.ts reads SPREADSHEET_ID at module scope, so it has to be set before
// the import below — this also documents that the module no longer falls back
// to a hardcoded production id (see the review, S3).
process.env.SPREADSHEET_ID = 'test-spreadsheet-id';

const valuesGet = vi.fn();
const valuesUpdate = vi.fn(async () => ({}));
vi.mock('googleapis', () => ({
  google: {
    sheets: () => ({ spreadsheets: { values: { get: valuesGet, update: valuesUpdate } } }),
  },
}));
vi.mock('google-auth-library', () => ({ GoogleAuth: class {} }));

const { columnLetter, getRowObjects, updateRow, SPREADSHEET_ID } = await import('../client');

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

  it('covers the current widest tab (Signups, 18 columns)', () => {
    expect(columnLetter(18)).toBe('R');
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
 * the wrong fields with no error. These tests pin that contract down; see
 * planner/2026-09-05-code-security-review.md, R1.
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
