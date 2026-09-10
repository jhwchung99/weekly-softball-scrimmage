import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Signup, SIGNUP_HEADERS, RawRow } from '../schema';

/**
 * One behaviour contract, run against both adapters at the Signups seam.
 *
 * The seam has two implementations — the real repository over Sheets, and
 * `fakeSheets` for flow and route tests — and two is the right number: an
 * in-memory adapter is what keeps the rest of the suite off the network. What
 * was missing is the thing that makes two adapters safe, which is a single
 * suite both must pass.
 *
 * Without it the fake had already drifted on `findPendingGuestInvite`, the
 * rule that gates giving away a roster spot: it accepted any non-cancelled
 * guest where production accepts only a waitlisted one, and dropped the
 * "not already waiting on an answer" clause entirely. Tests written against
 * the fake were therefore asserting a rule the app does not have. See
 * planner/2026-09-09-architecture-review.html, candidate 5.
 *
 * The real adapter runs here against an in-memory stand-in for `client`, so
 * every rule under test is the production one. Only storage is substituted —
 * and it stores strings, because that is all a Sheets cell ever returns.
 */

interface StubSheet {
  rows: string[][];
}
const sheet: StubSheet = { rows: [] };

vi.mock('../client', () => ({
  SPREADSHEET_ID: 'test-spreadsheet',
  columnLetter: (n: number) => String.fromCharCode(64 + n),
  getRowObjects: async (_id: string, _tab: string, headers: readonly string[]) =>
    sheet.rows
      .map((row, i) => ({ row, rowNumber: i + 2 }))
      .filter(({ row }) => row.some((cell) => cell !== undefined && cell !== ''))
      .map(({ row, rowNumber }) => {
        const data: Record<string, unknown> = {};
        headers.forEach((header, idx) => (data[header] = row[idx] ?? ''));
        return { rowNumber, data };
      }),
  appendValues: async (_id: string, _range: string, values: unknown[][]) => {
    for (const row of values) sheet.rows.push(row.map((cell) => String(cell ?? '')));
  },
  updateRow: async (_id: string, _tab: string, rowNumber: number, headers: readonly string[], data: Record<string, unknown>) => {
    sheet.rows[rowNumber - 2] = headers.map((h) => String(data[h] ?? ''));
  },
  batchUpdateRows: async (_id: string, updates: { range: string; values: unknown[] }[]) => {
    for (const { range, values } of updates) {
      const rowNumber = Number(/!A(\d+):/.exec(range)![1]);
      sheet.rows[rowNumber - 2] = values.map((cell) => String(cell ?? ''));
    }
  },
  deleteRow: async (_id: string, _sheetId: number, rowNumber: number) => {
    sheet.rows.splice(rowNumber - 2, 1);
  },
  getOrCreateSheet: async (_id: string, title: string) => ({ title, sheetId: 1 }),
}));

const realSignups = await import('../signups');
const { fakeSignupsModule, makeSignup } = await import('../../test/fakeSheets');
type FakeStore = import('../../test/fakeSheets').FakeStore;

const SESSION = '2099-01-01';

/** The two adapters, each with a way to empty it between tests. */
const adapters = [
  {
    name: 'real repository (over an in-memory sheet)',
    module: realSignups,
    reset: () => {
      sheet.rows = [];
    },
  },
  (() => {
    const store: FakeStore = { sessions: new Map(), signups: new Map(), players: new Map() };
    return {
      name: 'fakeSheets',
      module: fakeSignupsModule(store) as unknown as typeof realSignups,
      reset: () => store.signups.clear(),
    };
  })(),
];

describe.each(adapters)('Signups adapter contract — $name', ({ module, reset }) => {
  beforeEach(() => reset());

  /** Seeds through the adapter's own write path, so both halves are covered. */
  async function seed(over: Partial<Signup> = {}): Promise<Signup> {
    const { signupId: _ignored, ...rest } = makeSignup({ sessionId: SESSION, ...over });
    return module.createSignup(rest);
  }

  describe('findPendingGuestInvite', () => {
    const guest = (over: Partial<Signup> = {}): Partial<Signup> => ({
      memberStatus: 'guest',
      willingToShare: true,
      invitedByName: 'Member Mary',
      status: 'waitlisted',
      pairId: '',
      subRequestStatus: '',
      ...over,
    });

    it('offers a waitlisted guest who named the member and is willing to share', async () => {
      const created = await seed(guest({ email: 'guest@dummy.test' }));

      const found = await module.findPendingGuestInvite(SESSION, 'Member Mary');
      expect(found?.signupId).toBe(created.signupId);
    });

    it('does not offer a guest who already has a confirmed spot', async () => {
      // Folding them into someone else's spot would drop the roster under
      // capacity with no promotion to refill it.
      await seed(guest({ email: 'guest@dummy.test', status: 'confirmed' }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });

    it('does not offer a guest who is already waiting on an answer', async () => {
      await seed(guest({ email: 'guest@dummy.test', subRequestStatus: 'pending', subRequestTargetEmail: 'other@dummy.test' }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });

    it('offers a guest whose earlier request was declined', async () => {
      const created = await seed(guest({ email: 'guest@dummy.test', subRequestStatus: 'declined' }));

      expect((await module.findPendingGuestInvite(SESSION, 'Member Mary'))?.signupId).toBe(created.signupId);
    });

    it('does not offer a guest who is already paired', async () => {
      await seed(guest({ email: 'guest@dummy.test', pairId: 'pair-1' }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });

    it('does not offer a guest who is not willing to share', async () => {
      await seed(guest({ email: 'guest@dummy.test', willingToShare: false }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });

    it('does not offer a member, however they are configured', async () => {
      await seed(guest({ email: 'member@dummy.test', memberStatus: 'member' }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });

    it('does not offer a guest who named someone else', async () => {
      await seed(guest({ email: 'guest@dummy.test', invitedByName: 'Someone Else' }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });

    it('matches the inviter name regardless of casing and surrounding space', async () => {
      const created = await seed(guest({ email: 'guest@dummy.test', invitedByName: '  member mary ' }));

      expect((await module.findPendingGuestInvite(SESSION, 'Member Mary'))?.signupId).toBe(created.signupId);
    });

    it('offers the earliest of several eligible guests, so the queue is FIFO', async () => {
      const later = await seed(guest({ email: 'later@dummy.test', timestamp: '2099-01-02T00:00:00.000Z' }));
      const earlier = await seed(guest({ email: 'earlier@dummy.test', timestamp: '2099-01-01T00:00:00.000Z' }));

      const found = await module.findPendingGuestInvite(SESSION, 'Member Mary');
      expect(found?.signupId).toBe(earlier.signupId);
      expect(found?.signupId).not.toBe(later.signupId);
    });

    it('ignores an eligible guest in a different session', async () => {
      await seed(guest({ email: 'guest@dummy.test', sessionId: '2099-06-06' }));

      expect(await module.findPendingGuestInvite(SESSION, 'Member Mary')).toBeNull();
    });
  });

  describe('findActiveSignup', () => {
    it('finds a signup regardless of the casing it was asked for', async () => {
      const created = await seed({ email: 'Kevin@Dummy.Test' });

      expect((await module.findActiveSignup(SESSION, 'kevin@dummy.test'))?.signupId).toBe(created.signupId);
    });

    it('does not count a cancelled row as active', async () => {
      await seed({ email: 'kevin@dummy.test', status: 'cancelled' });

      expect(await module.findActiveSignup(SESSION, 'kevin@dummy.test')).toBeNull();
    });
  });

  describe('createSignup', () => {
    it('refuses a second active signup for the same person and session', async () => {
      await seed({ email: 'kevin@dummy.test' });

      await expect(seed({ email: 'kevin@dummy.test' })).rejects.toThrow(/already signed up/);
    });

    it('allows signing up again after cancelling', async () => {
      await seed({ email: 'kevin@dummy.test', status: 'cancelled' });

      await expect(seed({ email: 'kevin@dummy.test' })).resolves.toBeTruthy();
    });

    it('treats differently-cased addresses as the same person', async () => {
      await seed({ email: 'kevin@dummy.test' });

      await expect(seed({ email: 'KEVIN@DUMMY.TEST' })).rejects.toThrow(/already signed up/);
    });

    it('normalizes the address on the way in, so no new casing reaches storage', async () => {
      const created = await seed({ email: 'Kevin@Dummy.Test' });

      expect(created.email).toBe('kevin@dummy.test');
      expect((await module.getSignup(created.signupId))?.email).toBe('kevin@dummy.test');
    });

    it('assigns an id rather than trusting the caller', async () => {
      const created = await seed({ email: 'kevin@dummy.test' });

      expect(created.signupId).toBeTruthy();
      expect(created.signupId).not.toBe('fixture');
    });
  });

  describe('reads and writes round-trip', () => {
    it('preserves booleans and numbers through storage', async () => {
      const created = await seed({ email: 'kevin@dummy.test', paid: true, amountPaid: 17.5, attended: true, willingToShare: true });

      const read = await module.getSignup(created.signupId);
      expect(read).toMatchObject({ paid: true, amountPaid: 17.5, attended: true, willingToShare: true });
    });

    it('applies a partial update without disturbing the other fields', async () => {
      const created = await seed({ email: 'kevin@dummy.test', fullName: 'Kevin Kim', positions: 'Catcher' });

      await module.updateSignup(created.signupId, { status: 'confirmed' });

      expect(await module.getSignup(created.signupId)).toMatchObject({
        status: 'confirmed',
        fullName: 'Kevin Kim',
        positions: 'Catcher',
      });
    });

    it('applies several updates at once and returns each updated row', async () => {
      const a = await seed({ email: 'a@dummy.test' });
      const b = await seed({ email: 'b@dummy.test' });

      const updated = await module.batchUpdateSignups([
        { signupId: a.signupId, updates: { status: 'confirmed' } },
        { signupId: b.signupId, updates: { teamName: 'Team 2' } },
      ]);

      expect(updated.find((s) => s.signupId === a.signupId)?.status).toBe('confirmed');
      expect(updated.find((s) => s.signupId === b.signupId)?.teamName).toBe('Team 2');
      expect((await module.getSignup(a.signupId))?.status).toBe('confirmed');
      expect((await module.getSignup(b.signupId))?.teamName).toBe('Team 2');
    });

    it('removes a row outright on delete', async () => {
      const created = await seed({ email: 'kevin@dummy.test' });

      await module.deleteSignup(created.signupId);

      expect(await module.getSignup(created.signupId)).toBeNull();
      expect(await module.listSignupsForSession(SESSION)).toEqual([]);
    });

    it('lists only the requested session', async () => {
      await seed({ email: 'a@dummy.test' });
      await seed({ email: 'b@dummy.test', sessionId: '2099-06-06' });

      const listed = await module.listSignupsForSession(SESSION);
      expect(listed.map((s) => s.email)).toEqual(['a@dummy.test']);
    });

    it('returns one signup alongside its session in a single ask', async () => {
      const created = await seed({ email: 'a@dummy.test' });
      await seed({ email: 'b@dummy.test' });

      const { signup, sessionSignups } = await module.getSignupWithSessionSignups(created.signupId);
      expect(signup?.signupId).toBe(created.signupId);
      expect(sessionSignups).toHaveLength(2);
    });
  });
});

/** Guards the stand-in itself: if it stopped modelling Sheets' string-only
 * cells, the real adapter above would be passing against fiction. */
describe('the in-memory sheet used to run the real adapter', () => {
  it('stores every cell as a string, the way a Sheets cell comes back', async () => {
    sheet.rows = [];
    const { signupId: _ignored, ...rest } = makeSignup({ sessionId: SESSION, paid: true, amountPaid: 17.5 });
    await realSignups.createSignup(rest);

    expect(sheet.rows).toHaveLength(1);
    for (const cell of sheet.rows[0]) expect(typeof cell).toBe('string');
  });

  it('lays cells out in SIGNUP_HEADERS order', async () => {
    sheet.rows = [];
    const { signupId: _ignored, ...rest } = makeSignup({ sessionId: SESSION, fullName: 'Kevin Kim' });
    await realSignups.createSignup(rest);

    const row = sheet.rows[0];
    const asObject = Object.fromEntries(SIGNUP_HEADERS.map((h, i) => [h, row[i]])) as RawRow<Signup>;
    expect(asObject.fullName).toBe('Kevin Kim');
    expect(asObject.sessionId).toBe(SESSION);
  });
});
