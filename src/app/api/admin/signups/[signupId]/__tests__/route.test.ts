import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, resetFakeStore, makeSession, makeSignup } from '../../../../../../test/fakeSheets';
import type { FakeStore } from '../../../../../../test/fakeSheets';

/**
 * Backed by `fakeSheets` rather than a set of bare `vi.fn()`s written for this
 * file alone.
 *
 * The Signups seam is meant to have two adapters — the real repository and the
 * one in-memory fake — and a contract test that keeps them equivalent
 * (sheets/__tests__/signupsContract.test.ts). A third double defined here made
 * that three, and this one answered to nobody: it returned whatever each test
 * told it to, including states the real repository would never produce. Now
 * this route is exercised against the same adapter the contract pins.
 */

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));
vi.mock('../../../../../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../../../../../sheets/sessions', () => fakeSessionsModule(store));

const requireAdmin = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin }));

const lockRuns = { enabled: true };
const withMutationLock = vi.fn(async (fn: () => unknown) => (lockRuns.enabled ? fn() : undefined));
vi.mock('../../../../../../lib/lock', () => ({ withMutationLock }));

vi.mock('../../../../../../lib/ntfy', () => ({ sendPush: vi.fn() }));
vi.mock('../../../../../../lib/gmail', () => ({ sendEmail: vi.fn() }));

const { PATCH, DELETE } = await import('../route');
const signups = await import('../../../../../../sheets/signups');

const SESSION = '2099-01-01';

function makeParams(signupId: string) {
  return { params: Promise.resolve({ signupId }) };
}

function patch(signupId: string, body: unknown) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), makeParams(signupId));
}

function del(signupId: string) {
  return DELETE(new Request('http://x', { method: 'DELETE' }), makeParams(signupId));
}

/** Puts a row in the store, the way the sheet would actually hold it. */
function seed(overrides: Partial<ReturnType<typeof makeSignup>> = {}) {
  const row = makeSignup({
    signupId: 'old',
    sessionId: SESSION,
    email: 'kevin@dummy.test',
    fullName: 'Kevin Kim',
    status: 'cancelled',
    ...overrides,
  });
  store.signups.set(row.signupId, row);
  return row;
}

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  lockRuns.enabled = true;
  requireAdmin.mockResolvedValue('admin@dummy.test');
  store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, pricePerSpot: 10 }));
});

describe('PATCH /api/admin/signups/[signupId] — reviving a cancelled row', () => {
  it('refuses when the same person already has an active signup, naming the conflict', async () => {
    // Kevin cancelled and signed up again; 'old' is the stale row.
    seed();
    seed({ signupId: 'new', status: 'confirmed' });

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Kevin Kim already has an active signup/);
    expect(body.error).toMatch(/confirmed/);
    expect(store.signups.get('old')?.status).toBe('cancelled');
  });

  it('matches the conflicting row regardless of email casing', async () => {
    seed({ email: 'KEVIN@DUMMY.TEST' });
    seed({ signupId: 'new', email: 'kevin@dummy.test', status: 'waitlisted' });

    expect((await patch('old', { status: 'confirmed' })).status).toBe(409);
  });

  it('allows it when their other rows are all cancelled too', async () => {
    seed();
    seed({ signupId: 'older', status: 'cancelled' });

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(200);
    expect(store.signups.get('old')?.status).toBe('confirmed');
  });

  it('still lets an admin cancel a row, which is how a double-booking gets repaired', async () => {
    seed({ status: 'confirmed' });
    seed({ signupId: 'new', status: 'confirmed' });

    const res = await patch('old', { status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(store.signups.get('old')?.status).toBe('cancelled');
  });

  it('does not block confirmed -> waitlisted on a roster that is already double-booked', async () => {
    // Repairing such a roster must not be harder than creating it was.
    seed({ status: 'confirmed' });
    seed({ signupId: 'new', status: 'confirmed' });

    expect((await patch('old', { status: 'waitlisted' })).status).toBe(200);
  });

  it('costs no extra Sheets read for a status move that cannot duplicate anyone', async () => {
    seed({ status: 'confirmed' });

    await patch('old', { status: 'waitlisted' });

    expect(signups.listSignupsForSession).not.toHaveBeenCalled();
  });

  it('reads this session once when a revive is checked and a payment is recorded together', async () => {
    seed();

    const res = await patch('old', { status: 'confirmed', paid: true });

    expect(res.status).toBe(200);
    expect(signups.listSignupsForSession).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/admin/signups/[signupId] — recording what happened', () => {
  it('records what was owed when the organizer ticks paid', async () => {
    seed({ status: 'confirmed' });

    const res = await patch('old', { paid: true });

    expect(res.status).toBe(200);
    const row = store.signups.get('old')!;
    expect(row.paid).toBe(true);
    expect(row.amountPaid).toBe(10); // the session's price for one spot
    expect(row.paidAt).not.toBe('');
  });

  it('takes an explicit amount over the computed one', async () => {
    seed({ status: 'confirmed' });

    await patch('old', { paid: true, amountPaid: 7.5 });

    expect(store.signups.get('old')?.amountPaid).toBe(7.5);
  });

  it('clears the record when the organizer un-ticks paid, since it was a mistake not a refund', async () => {
    seed({ status: 'confirmed', paid: true, amountPaid: 10, paidAt: '2099-01-01T00:00:00.000Z' });

    await patch('old', { paid: false });

    expect(store.signups.get('old')).toMatchObject({ paid: false, amountPaid: 0, paidAt: '' });
  });

  it('rejects a negative amount', async () => {
    seed({ status: 'confirmed' });

    expect((await patch('old', { amountPaid: -5 })).status).toBe(400);
  });

  it('rejects an unknown status', async () => {
    seed();

    const res = await patch('old', { status: 'paused' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/status must be one of/);
  });

  it('rejects an empty update', async () => {
    seed();

    expect((await patch('old', {})).status).toBe(400);
  });

  it('404s for a signup that does not exist', async () => {
    expect((await patch('ghost', { status: 'confirmed' })).status).toBe(404);
  });
});

describe('DELETE /api/admin/signups/[signupId]', () => {
  it('removes the row outright', async () => {
    seed({ status: 'confirmed' });

    const res = await del('old');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.signups.has('old')).toBe(false);
  });

  it('404s for a signup that does not exist', async () => {
    expect((await del('ghost')).status).toBe(404);
  });
});

/**
 * Both halves change capacity accounting, so both belong inside the lock. The
 * assertion is what reached the store, not how the lock was called — so it
 * survives the acquisition moving, as it already has once.
 */
describe('admin signup override — serialization', () => {
  it('writes no status change when the lock does not run its callback', async () => {
    seed({ status: 'waitlisted' });
    lockRuns.enabled = false;

    await patch('old', { status: 'confirmed' }).catch(() => {});

    expect(store.signups.get('old')?.status).toBe('waitlisted');
  });

  it('records no payment when the lock does not run its callback', async () => {
    seed({ status: 'confirmed' });
    lockRuns.enabled = false;

    await patch('old', { paid: true }).catch(() => {});

    expect(store.signups.get('old')?.paid).toBe(false);
  });

  it('deletes no row when the lock does not run its callback', async () => {
    seed({ status: 'confirmed' });
    lockRuns.enabled = false;

    await del('old').catch(() => {});

    expect(store.signups.has('old')).toBe(true);
  });

  it('returns the same busy error as every other serialized route', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    seed({ status: 'waitlisted' });
    withMutationLock.mockRejectedValueOnce(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/busy processing other requests/);
  });

  it('still rejects an invalid status with a 400, rather than making it queue for a lock it never needed', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    seed({ status: 'waitlisted' });
    withMutationLock.mockRejectedValue(new ApiError(503, 'busy'));

    const res = await patch('old', { status: 'bogus' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/status must be one of/);
  });
});
