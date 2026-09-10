import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin }));

const getSession = vi.fn();
vi.mock('../../../../../../sheets/sessions', () => ({ getSession }));

const reviseSession = vi.fn();
vi.mock('../../../../../../lib/adminFlow', () => ({ reviseSession }));

const { GET, PATCH } = await import('../route');

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function patch(sessionId: string, body: unknown) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), makeParams(sessionId));
}

const SESSION = { sessionId: '2099-01-01', gameDate: '2099-01-01', gameTime: '18:00', capacity: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue('admin@dummy.test');
  getSession.mockResolvedValue(SESSION);
  reviseSession.mockResolvedValue({ session: SESSION, promoted: [] });
});

describe('GET /api/admin/sessions/[sessionId]', () => {
  it('returns 403 for a non-admin caller', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    requireAdmin.mockRejectedValue(new ApiError(403, '"a@dummy.test" is not an admin.'));

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(403);
  });

  it('returns 404 for a session that does not exist', async () => {
    getSession.mockResolvedValue(null);

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(404);
  });

  it('returns the session for an admin', async () => {
    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));

    expect(res.status).toBe(200);
    expect((await res.json()).session.capacity).toBe(10);
  });
});

/**
 * The route validates and delegates; `reviseSession` does the work and
 * serializes itself (see lib/adminFlow.ts, and flowSerialization.test.ts for
 * the assertion that none of its writes escape the lock).
 *
 * So what belongs here is what the route is still responsible for: rejecting
 * bad input before anything is attempted, passing on exactly what it was
 * given, and reporting back what the flow returned.
 */
describe('PATCH /api/admin/sessions/[sessionId] — validation', () => {
  it('rejects a negative cost', async () => {
    expect((await patch('2099-01-01', { cost: -5 })).status).toBe(400);
  });

  it('rejects a negative capacity', async () => {
    expect((await patch('2099-01-01', { capacity: -1 })).status).toBe(400);
  });

  it('rejects an unknown status', async () => {
    const res = await patch('2099-01-01', { status: 'paused' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/status must be one of/);
  });

  it('rejects an empty update body', async () => {
    expect((await patch('2099-01-01', {})).status).toBe(400);
  });

  it('returns 404 for a session that does not exist', async () => {
    getSession.mockResolvedValue(null);

    expect((await patch('2099-01-01', { capacity: 12 })).status).toBe(404);
  });

  it('attempts nothing at all when the input is bad', async () => {
    // Validation runs before the flow is called, so a request that is going to
    // 400 never queues behind another mutation waiting for the lock.
    await patch('2099-01-01', { capacity: -1 });

    expect(reviseSession).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/sessions/[sessionId] — delegation', () => {
  it('passes the validated field updates through', async () => {
    await patch('2099-01-01', { cost: 12.5, capacity: 15 });

    expect(reviseSession).toHaveBeenCalledWith(
      '2099-01-01',
      SESSION,
      expect.objectContaining({ updates: { capacity: 15, cost: 12.5 } })
    );
  });

  it('passes a reschedule through alongside the other fields', async () => {
    await patch('2026-07-10', { gameDate: '2026-07-11', gameTime: '20:00', capacity: 15 });

    expect(reviseSession).toHaveBeenCalledWith(
      '2026-07-10',
      SESSION,
      expect.objectContaining({ gameDate: '2026-07-11', gameTime: '20:00', updates: { capacity: 15 } })
    );
  });

  it('leaves the flow to fill in a half-given reschedule from the existing session', async () => {
    // The route does not guess the missing half; the flow has the existing row.
    await patch('2026-07-10', { gameTime: '20:00' });

    expect(reviseSession).toHaveBeenCalledWith(
      '2026-07-10',
      SESSION,
      expect.objectContaining({ gameDate: undefined, gameTime: '20:00' })
    );
  });

  it('reports the session the flow returned, which may have a new id', async () => {
    reviseSession.mockResolvedValue({
      session: { ...SESSION, sessionId: '2026-07-11' },
      promoted: [{ signupId: 'a' }, { signupId: 'b' }],
    });

    const res = await patch('2026-07-10', { gameDate: '2026-07-11' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session.sessionId).toBe('2026-07-11');
    expect(body.promoted).toBe(2);
  });

  it('propagates a rejection from the flow, such as an id collision', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    reviseSession.mockRejectedValue(new ApiError(409, 'A session for 2026-07-11 already exists.'));

    expect((await patch('2026-07-10', { gameDate: '2026-07-11' })).status).toBe(409);
  });

  it('returns the same busy error as every other serialized route', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    reviseSession.mockRejectedValue(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    const res = await patch('2099-01-01', { capacity: 20 });

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/busy processing other requests/);
  });
});
