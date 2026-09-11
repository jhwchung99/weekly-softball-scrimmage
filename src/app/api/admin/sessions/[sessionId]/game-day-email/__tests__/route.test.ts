import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFakeStore,
  resetFakeStore,
  fakeSessionsModule,
  fakeSignupsModule,
  makeSession,
  makeSignup,
} from '../../../../../../../test/fakeSheets';

/**
 * The sheets layer is faked rather than the flow mocked, for the same reason
 * the teams route's test does it: a test that stubs the send cannot see that
 * the send was refused for the right reason.
 */

const requireAdmin = vi.fn();
vi.mock('../../../../../../../lib/auth', () => ({ requireAdmin }));

const guardAnnouncement = vi.fn();
vi.mock('../../../../../../../lib/announcementGuard', () => ({ guardAnnouncement }));

const sendEmail = vi.fn();
vi.mock('../../../../../../../lib/gmail', () => ({ sendEmail }));

const store = createFakeStore();
vi.mock('../../../../../../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../../../../../../sheets/signups', () => fakeSignupsModule(store));

const { POST } = await import('../route');

const SESSION = '2026-07-10';

function post(sessionId = SESSION) {
  return POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ sessionId }) });
}

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(undefined);
  guardAnnouncement.mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  // 2pm ET on game day: past the 1pm lock for an 18:00 game.
  vi.setSystemTime(new Date('2026-07-10T18:00:00.000Z'));
});

function seedLockedSession() {
  store.sessions.set(
    SESSION,
    makeSession({ sessionId: SESSION, gameDate: SESSION, gameTime: '18:00', capacity: 5, pricePerSpot: 10, status: 'closed' })
  );
  store.signups.set(
    's1',
    makeSignup({ signupId: 's1', sessionId: SESSION, email: 'a@dummy.test', fullName: 'A', status: 'confirmed' })
  );
}

describe('POST /api/admin/sessions/[sessionId]/game-day-email', () => {
  it('emails the confirmed players and reports how many', async () => {
    seedLockedSession();

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('requires an admin', async () => {
    seedLockedSession();
    const { ApiError } = await import('../../../../../../../lib/apiErrors');
    requireAdmin.mockRejectedValue(new ApiError(403, 'Admins only.'));

    expect((await post()).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('honours the double-send cooldown', async () => {
    seedLockedSession();
    const { ApiError } = await import('../../../../../../../lib/apiErrors');
    guardAnnouncement.mockRejectedValue(new ApiError(429, 'That was just sent.'));

    expect((await post()).status).toBe(429);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses before the roster locks, rather than sending a figure that can still move', async () => {
    seedLockedSession();
    vi.setSystemTime(new Date('2026-07-10T13:00:00.000Z')); // 9am ET, pre-lock

    const res = await post();

    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('404s an unknown session', async () => {
    expect((await post('2026-01-01')).status).toBe(404);
  });
});
