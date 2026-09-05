import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../lib/auth', () => ({ requireAdmin }));

const adminCreateSession = vi.fn();
vi.mock('../../../../../lib/adminFlow', () => ({ adminCreateSession }));

const withMutationLock = vi.fn((fn: () => unknown) => fn());
vi.mock('../../../../../lib/lock', () => ({ withMutationLock }));

const { POST } = await import('../route');

beforeEach(() => {
  vi.clearAllMocks();
  withMutationLock.mockImplementation((fn: () => unknown) => fn());
});

describe('POST /api/admin/sessions', () => {
  it('returns 403 for a non-admin caller', async () => {
    const { ApiError } = await import('../../../../../lib/apiErrors');
    requireAdmin.mockRejectedValue(new ApiError(403, '"a@dummy.test" is not an admin.'));

    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ gameDate: '2026-07-10' }) }));
    expect(res.status).toBe(403);
  });

  it('creates a session under the mutation lock and returns it', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    adminCreateSession.mockResolvedValue({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00' });

    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ gameDate: '2026-07-10', gameTime: '18:00' }) })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.sessionId).toBe('2026-07-10');
    expect(withMutationLock).toHaveBeenCalledTimes(1);
    expect(adminCreateSession).toHaveBeenCalledWith({
      gameDate: '2026-07-10',
      gameTime: '18:00',
      capacity: undefined,
      cost: undefined,
      pricePerSpot: undefined,
      locationArea: undefined,
      openImmediately: false,
    });
  });

  it('propagates a validation error from adminCreateSession', async () => {
    const { ApiError } = await import('../../../../../lib/apiErrors');
    requireAdmin.mockResolvedValue('admin@dummy.test');
    adminCreateSession.mockRejectedValue(new ApiError(400, 'gameDate must fall on a Friday, Saturday, or Sunday.'));

    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ gameDate: '2026-07-06' }) }));
    expect(res.status).toBe(400);
  });
});
