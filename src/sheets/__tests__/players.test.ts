import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLAYER_HEADERS } from '../schema';

/**
 * The Players tab was 7% covered, and everything interesting about it is the
 * email matching. Identity comes from Google OAuth, email is the natural key,
 * and a row stored with different casing has to resolve to the same person —
 * otherwise a returning player silently gets a second profile and loses the
 * positions they saved.
 */

const getRowObjects = vi.fn<(id: string, tab: string, headers: readonly string[]) => Promise<unknown[]>>();
const appendValues = vi.fn<(id: string, range: string, rows: string[][]) => Promise<void>>(async () => undefined);
const updateRow = vi.fn<(id: string, tab: string, row: number, headers: readonly string[], values: unknown) => Promise<void>>(
  async () => undefined
);
vi.mock('../client', async () => {
  const { columnLetter } = await vi.importActual<typeof import('../client')>('../client');
  return { SPREADSHEET_ID: 'sheet', getRowObjects, appendValues, updateRow, columnLetter };
});

const { getPlayer, upsertPlayer } = await import('../players');

const KEVIN = { email: 'Kevin.Kim@Dummy.Test', fullName: 'Kevin Kim', gender: 'Male', savedPositions: 'SS, 2B' };

function seed(...rows: Record<string, string>[]) {
  getRowObjects.mockResolvedValue(rows.map((data, i) => ({ rowNumber: i + 2, data })));
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe('getPlayer', () => {
  it('finds a profile', async () => {
    seed(KEVIN);
    await expect(getPlayer('Kevin.Kim@Dummy.Test')).resolves.toMatchObject({ fullName: 'Kevin Kim' });
  });

  it('matches regardless of casing on either side', async () => {
    // A legacy row and a fresh login can disagree about case, and they are
    // the same person.
    seed(KEVIN);
    await expect(getPlayer('kevin.kim@dummy.test')).resolves.toMatchObject({ fullName: 'Kevin Kim' });
  });

  it('is null for someone who has never signed up', async () => {
    seed(KEVIN);
    await expect(getPlayer('stranger@dummy.test')).resolves.toBeNull();
  });

  it('is null when the tab is empty', async () => {
    await expect(getPlayer('kevin@dummy.test')).resolves.toBeNull();
  });
});

describe('upsertPlayer', () => {
  it('appends a row for a first-time player', async () => {
    await upsertPlayer(KEVIN);

    expect(updateRow).not.toHaveBeenCalled();
    expect(appendValues).toHaveBeenCalledWith('sheet', 'Players!A:D', [
      PLAYER_HEADERS.map((h) => (h === 'email' ? 'kevin.kim@dummy.test' : KEVIN[h])),
    ]);
  });

  it('stores the email normalized, so the next lookup finds it', async () => {
    await upsertPlayer(KEVIN);

    const [, , [row]] = appendValues.mock.calls.at(-1)!;
    expect(row[PLAYER_HEADERS.indexOf('email')]).toBe('kevin.kim@dummy.test');
  });

  it('updates in place rather than adding a duplicate', async () => {
    // "Update my positions" must not leave two rows for one person: getPlayer
    // takes the first match, so the newer one would be invisible.
    seed({ ...KEVIN, email: 'kevin.kim@dummy.test' });

    await upsertPlayer({ ...KEVIN, savedPositions: 'Catcher' });

    expect(appendValues).not.toHaveBeenCalled();
    expect(updateRow).toHaveBeenCalledWith('sheet', 'Players', 2, PLAYER_HEADERS, expect.objectContaining({ savedPositions: 'Catcher' }));
  });

  it('updates the right row when several players exist', async () => {
    seed({ ...KEVIN, email: 'someone@dummy.test' }, { ...KEVIN, email: 'kevin.kim@dummy.test' });

    await upsertPlayer(KEVIN);

    expect(updateRow).toHaveBeenCalledWith('sheet', 'Players', 3, PLAYER_HEADERS, expect.anything());
  });

  it('matches an existing row whose stored casing differs', async () => {
    seed({ ...KEVIN, email: 'KEVIN.KIM@DUMMY.TEST' });

    await upsertPlayer({ ...KEVIN, email: 'kevin.kim@dummy.test' });

    expect(appendValues).not.toHaveBeenCalled();
    expect(updateRow).toHaveBeenCalled();
  });
});
