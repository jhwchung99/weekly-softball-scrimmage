import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin }));

const getSignup = vi.fn();
const updateSignup = vi.fn();
const deleteSignup = vi.fn();
const listSignupsForSession = vi.fn();
vi.mock('../../../../../../sheets/signups', () => ({
  getSignup,
  updateSignup,
  deleteSignup,
  listSignupsForSession,
}));

const getSession = vi.fn();
vi.mock('../../../../../../sheets/sessions', () => ({ getSession }));

const withMutationLock = vi.fn((fn: () => unknown) => fn());
vi.mock('../../../../../../lib/lock', () => ({ withMutationLock }));

const { PATCH, DELETE } = await import('../route');

/** A lock that refuses to run its callback, so anything the handler still
 * manages to write is a write that was never inside the lock. */
function lockNeverRuns() {
  withMutationLock.mockImplementation(() => Promise.resolve(undefined));
}

function makeParams(signupId: string) {
  return { params: Promise.resolve({ signupId }) };
}

function patch(signupId: string, body: unknown) {
  return PATCH(
    new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }),
    makeParams(signupId)
  );
}

const signup = (overrides: Record<string, unknown> = {}) => ({
  signupId: 'old',
  sessionId: '2099-01-01',
  email: 'kevin@dummy.test',
  fullName: 'Kevin Kim',
  status: 'cancelled',
  pairId: '',
  paid: false,
  amountPaid: 0,
  subRequestStatus: '',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue('admin@dummy.test');
  withMutationLock.mockImplementation((fn: () => unknown) => fn());
  updateSignup.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({ signupId: id, ...updates }));
});

describe('PATCH /api/admin/signups/[signupId] — reviving a cancelled row', () => {
  it('refuses when the same person already has an active signup, naming the conflict', async () => {
    // Kevin cancelled and signed up again; 'old' is the stale row.
    getSignup.mockResolvedValue(signup());
    listSignupsForSession.mockResolvedValue([
      signup(),
      signup({ signupId: 'new', status: 'confirmed' }),
    ]);

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Kevin Kim already has an active signup/);
    expect(body.error).toMatch(/confirmed/);
    expect(updateSignup).not.toHaveBeenCalled();
  });

  it('matches the conflicting row regardless of email casing', async () => {
    getSignup.mockResolvedValue(signup({ email: 'KEVIN@DUMMY.TEST' }));
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'KEVIN@DUMMY.TEST' }),
      signup({ signupId: 'new', status: 'waitlisted' }),
    ]);

    expect((await patch('old', { status: 'confirmed' })).status).toBe(409);
  });

  it('allows it when their other rows are all cancelled too', async () => {
    getSignup.mockResolvedValue(signup());
    listSignupsForSession.mockResolvedValue([
      signup(),
      signup({ signupId: 'older', status: 'cancelled' }),
    ]);

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(200);
    expect(updateSignup).toHaveBeenCalledWith('old', expect.objectContaining({ status: 'confirmed' }));
  });

  it('still lets an admin cancel a row, which is how a double-booking gets repaired', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));
    listSignupsForSession.mockResolvedValue([
      signup({ status: 'confirmed' }),
      signup({ signupId: 'new', status: 'confirmed' }),
    ]);

    const res = await patch('old', { status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(updateSignup).toHaveBeenCalledWith('old', expect.objectContaining({ status: 'cancelled' }));
  });

  it('does not block confirmed -> waitlisted on a roster that is already double-booked', async () => {
    // Repairing such a roster must not be harder than creating it was.
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));
    listSignupsForSession.mockResolvedValue([
      signup({ status: 'confirmed' }),
      signup({ signupId: 'new', status: 'confirmed' }),
    ]);

    expect((await patch('old', { status: 'waitlisted' })).status).toBe(200);
  });

  it('costs no extra Sheets read for a status move that cannot duplicate anyone', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));

    await patch('old', { status: 'waitlisted' });

    expect(listSignupsForSession).not.toHaveBeenCalled();
  });

  it('reads this session once when a revive is checked and a payment is recorded together', async () => {
    getSignup.mockResolvedValue(signup());
    listSignupsForSession.mockResolvedValue([signup()]);
    getSession.mockResolvedValue({ sessionId: '2099-01-01', pricePerSpot: 10, cost: 0 });

    const res = await patch('old', { status: 'confirmed', paid: true });

    expect(res.status).toBe(200);
    expect(listSignupsForSession).toHaveBeenCalledTimes(1);
  });
});

/**
 * Both halves of this route change capacity accounting — a status move
 * decides who holds a spot, and a delete frees one — so both belong inside
 * the same global mutation lock every other roster write takes. Neither took
 * it at all before.
 *
 * These assert what reaches the repository rather than how the lock is
 * called, so they keep working when the acquisition eventually moves down
 * into the flow modules.
 */
describe('admin signup override — serialization', () => {
  it('writes no status change when the lock does not run its callback', async () => {
    getSignup.mockResolvedValue(signup({ status: 'waitlisted' }));
    lockNeverRuns();

    await patch('old', { status: 'confirmed' });

    expect(updateSignup).not.toHaveBeenCalled();
  });

  it('records no payment when the lock does not run its callback', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));
    getSession.mockResolvedValue({ sessionId: '2099-01-01', pricePerSpot: 10, cost: 0 });
    lockNeverRuns();

    await patch('old', { paid: true });

    expect(updateSignup).not.toHaveBeenCalled();
  });

  it('deletes no row when the lock does not run its callback', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));
    lockNeverRuns();

    await DELETE(new Request('http://x', { method: 'DELETE' }), makeParams('old'));

    expect(deleteSignup).not.toHaveBeenCalled();
  });

  it('still deletes the row when the lock runs normally', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), makeParams('old'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteSignup).toHaveBeenCalledWith('old');
  });

  it('still 404s on a delete for a signup that does not exist', async () => {
    getSignup.mockResolvedValue(null);

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), makeParams('ghost'));

    expect(res.status).toBe(404);
    expect(deleteSignup).not.toHaveBeenCalled();
  });

  it('returns the same busy error as every other locked route', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    getSignup.mockResolvedValue(signup({ status: 'waitlisted' }));
    withMutationLock.mockRejectedValue(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/busy processing other requests/);
  });

  it('still rejects an invalid status with a 400, rather than making it queue for a lock it never needed', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    getSignup.mockResolvedValue(signup({ status: 'waitlisted' }));
    // A lock nobody can take. Validation happens before it, so this is still a 400.
    withMutationLock.mockRejectedValue(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    const res = await patch('old', { status: 'bogus' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/status must be one of/);
  });

  it('still rejects an empty update with a 400 before taking the lock', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    getSignup.mockResolvedValue(signup({ status: 'waitlisted' }));
    withMutationLock.mockRejectedValue(new ApiError(503, 'busy'));

    const res = await patch('old', {});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Provide at least one of/);
  });
});
