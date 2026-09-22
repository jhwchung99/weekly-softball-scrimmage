import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../lib/auth', () => ({ requireAdmin }));

const adminCreateSession = vi.fn();
vi.mock('../../../../../lib/adminFlow', () => ({ adminCreateSession }));


const { POST } = await import('../route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/sessions', () => {
  it('returns 403 for a non-admin caller', async () => {
    const { ApiError } = await import('../../../../../lib/apiErrors');
    requireAdmin.mockRejectedValue(new ApiError(403, '"a@dummy.test" is not an admin.'));

    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ gameDate: '2026-07-10' }) }));
    expect(res.status).toBe(403);
  });

  it('creates a session and returns it', async () => {
    requireAdmin.mockResolvedValue('admin@dummy.test');
    adminCreateSession.mockResolvedValue({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00' });

    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ gameDate: '2026-07-10', gameTime: '18:00' }) })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.sessionId).toBe('2026-07-10');
    expect(adminCreateSession).toHaveBeenCalledWith({
      gameDate: '2026-07-10',
      gameTime: '18:00',
      capacity: undefined,
      cost: undefined,
      pricePerSpot: undefined,
      locationArea: undefined,
      rosterLockAt: undefined,
      registrationOpensAt: undefined,
      registrationClosesAt: undefined,
      openImmediately: false,
    });
  });

  it('forwards the session\u2019s own schedule, which the form has always sent', async () => {
    // These were dropped on the floor between the create form and the flow, so
    // a midweek game could not be given the window it needs at the moment it
    // was created — and a Monday game is refused without one.
    requireAdmin.mockResolvedValue('admin@dummy.test');
    adminCreateSession.mockResolvedValue({ sessionId: '2026-07-06', gameDate: '2026-07-06', gameTime: '18:00' });

    await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({
          gameDate: '2026-07-06',
          registrationOpensAt: '2026-06-29T13:00:00.000Z',
          registrationClosesAt: '2026-07-04T04:00:00.000Z',
          rosterLockAt: '2026-07-06T17:00:00.000Z',
        }),
      })
    );

    expect(adminCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationOpensAt: '2026-06-29T13:00:00.000Z',
        registrationClosesAt: '2026-07-04T04:00:00.000Z',
        rosterLockAt: '2026-07-06T17:00:00.000Z',
      })
    );
  });

  it('propagates a validation error from adminCreateSession', async () => {
    const { ApiError } = await import('../../../../../lib/apiErrors');
    requireAdmin.mockResolvedValue('admin@dummy.test');
    adminCreateSession.mockRejectedValue(new ApiError(400, 'gameDate must fall on a Friday, Saturday, or Sunday.'));

    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ gameDate: '2026-07-06' }) }));
    expect(res.status).toBe(400);
  });
});
