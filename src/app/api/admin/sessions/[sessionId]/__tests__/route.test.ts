import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin }));

const getSession = vi.fn();
const updateSession = vi.fn();
vi.mock('../../../../../../sheets/sessions', () => ({ getSession, updateSession }));

const adminRescheduleSession = vi.fn();
vi.mock('../../../../../../lib/adminFlow', () => ({ adminRescheduleSession }));

const withMutationLock = vi.fn((fn: () => unknown) => fn());
vi.mock('../../../../../../lib/lock', () => ({ withMutationLock }));

const fillOpenSpots = vi.fn();
vi.mock('../../../../../../lib/signupFlow', () => ({ fillOpenSpots }));

const { GET, PATCH } = await import('../route');

/** A lock that refuses to run its callback, so anything the handler still
 * manages to write is a write that was never inside the lock. */
function lockNeverRuns() {
  withMutationLock.mockImplementation(() => Promise.resolve(undefined));
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  withMutationLock.mockImplementation((fn: () => unknown) => fn());
  fillOpenSpots.mockResolvedValue([]);
});

describe('GET /api/admin/sessions/[sessionId]', () => {
  it('returns 403 for a non-admin caller', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    requireAdmin.mockRejectedValue(new ApiError(403, '"a@dummy.test" is not an admin.'));

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(403);
  });

  it('returns 404 for a session that does not exist', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue(null);

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(404);
  });

  it('returns the session for an admin', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2099-01-01', capacity: 10 });

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.capacity).toBe(10);
  });
});

describe('PATCH /api/admin/sessions/[sessionId]', () => {
  it('rejects a negative cost', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2099-01-01' });

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ cost: -5 }) }),
      makeParams('2099-01-01')
    );
    expect(res.status).toBe(400);
  });

  it('accepts a valid cost update', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2099-01-01' });
    updateSession.mockResolvedValue({ sessionId: '2099-01-01', cost: 12.5 });

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ cost: 12.5 }) }),
      makeParams('2099-01-01')
    );
    expect(res.status).toBe(200);
    expect(updateSession).toHaveBeenCalledWith('2099-01-01', { cost: 12.5 });
  });

  it('rejects an empty update body', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2099-01-01' });

    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: '{}' }), makeParams('2099-01-01'));
    expect(res.status).toBe(400);
  });

  it('rejects a negative capacity', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2099-01-01' });

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: -1 }) }),
      makeParams('2099-01-01')
    );
    expect(res.status).toBe(400);
  });

  it('reschedules under the mutation lock and applies other field updates against the (possibly new) id', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00' });
    adminRescheduleSession.mockResolvedValue({ sessionId: '2026-07-11', gameDate: '2026-07-11', gameTime: '20:00' });
    updateSession.mockResolvedValue({ sessionId: '2026-07-11', gameDate: '2026-07-11', gameTime: '20:00', capacity: 15 });

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ gameDate: '2026-07-11', gameTime: '20:00', capacity: 15 }) }),
      makeParams('2026-07-10')
    );

    expect(res.status).toBe(200);
    expect(withMutationLock).toHaveBeenCalledTimes(1);
    expect(adminRescheduleSession).toHaveBeenCalledWith('2026-07-10', '2026-07-11', '20:00');
    // capacity update lands on the NEW id returned by the reschedule, not the original one.
    expect(updateSession).toHaveBeenCalledWith('2026-07-11', { capacity: 15 });
    const body = await res.json();
    expect(body.session.sessionId).toBe('2026-07-11');
  });

  it('fills in the existing gameDate/gameTime when only one of the two is provided', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00' });
    adminRescheduleSession.mockResolvedValue({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '20:00' });

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ gameTime: '20:00' }) }),
      makeParams('2026-07-10')
    );

    expect(res.status).toBe(200);
    expect(adminRescheduleSession).toHaveBeenCalledWith('2026-07-10', '2026-07-10', '20:00');
  });

  it('propagates a rejection from adminRescheduleSession (e.g. an id collision)', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00' });
    adminRescheduleSession.mockRejectedValue(new ApiError(409, 'A session for 2026-07-11 already exists.'));

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ gameDate: '2026-07-11' }) }),
      makeParams('2026-07-10')
    );
    expect(res.status).toBe(409);
  });
});

/**
 * Every write this route makes changes who holds a spot for the week, so every
 * one of them has to be inside the mutation lock — a capacity that lands
 * outside it can be read as "there is room" by a signup arriving before the
 * promotion cascade runs.
 *
 * These assert what reaches the repository rather than how the lock is called,
 * so they keep working when the acquisition eventually moves down into the
 * flow modules.
 */
describe('PATCH /api/admin/sessions/[sessionId] — serialization', () => {
  beforeEach(() => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    getSession.mockResolvedValue({ sessionId: '2099-01-01', gameDate: '2099-01-01', gameTime: '18:00', capacity: 10 });
    updateSession.mockResolvedValue({ sessionId: '2099-01-01', capacity: 20 });
    adminRescheduleSession.mockResolvedValue({ sessionId: '2099-01-02', gameDate: '2099-01-02', gameTime: '18:00' });
  });

  it('writes no capacity change when the lock does not run its callback', async () => {
    lockNeverRuns();

    await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: 20 }) }),
      makeParams('2099-01-01')
    );

    expect(updateSession).not.toHaveBeenCalled();
  });

  it('runs no part of a reschedule-plus-capacity revision outside the lock', async () => {
    lockNeverRuns();

    await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ gameDate: '2099-01-02', capacity: 20, status: 'closed', cost: 40 }),
      }),
      makeParams('2099-01-01')
    );

    expect(adminRescheduleSession).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(fillOpenSpots).not.toHaveBeenCalled();
  });

  it('runs no promotion cascade when the lock does not run its callback', async () => {
    lockNeverRuns();

    await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: 30 }) }),
      makeParams('2099-01-01')
    );

    expect(fillOpenSpots).not.toHaveBeenCalled();
  });

  it('still raises capacity and promotes from the waitlist when the lock runs normally', async () => {
    fillOpenSpots.mockResolvedValue([{ signupId: 'a' }, { signupId: 'b' }]);

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: 20 }) }),
      makeParams('2099-01-01')
    );

    expect(res.status).toBe(200);
    expect(updateSession).toHaveBeenCalledWith('2099-01-01', { capacity: 20 });
    expect(fillOpenSpots).toHaveBeenCalledWith('2099-01-01');
    expect((await res.json()).promoted).toBe(2);
  });

  it('leaves the waitlist alone when capacity is only lowered', async () => {
    updateSession.mockResolvedValue({ sessionId: '2099-01-01', capacity: 5 });

    await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: 5 }) }),
      makeParams('2099-01-01')
    );

    expect(fillOpenSpots).not.toHaveBeenCalled();
  });

  it('returns the same busy error as every other locked route', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    withMutationLock.mockRejectedValue(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: 20 }) }),
      makeParams('2099-01-01')
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/busy processing other requests/);
  });

  it('still rejects an invalid field with a 400, rather than making it queue for a lock it never needed', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    // A lock nobody can take. Validation happens before it, so this is still a 400.
    withMutationLock.mockRejectedValue(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ capacity: -1 }) }),
      makeParams('2099-01-01')
    );

    expect(res.status).toBe(400);
  });
});
