import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin }));

const getSession = vi.fn();
const updateSession = vi.fn();
vi.mock('../../../../../../sheets/sessions', () => ({ getSession, updateSession }));

const { GET, PATCH } = await import('../route');

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
