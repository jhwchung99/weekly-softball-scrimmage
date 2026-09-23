import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFakeStore,
  resetFakeStore,
  fakeSessionsModule,
  fakeSignupsModule,
  makeSession,
  makeSignup,
} from '../../../../../../../test/fakeSheets';
import { ApiError } from '../../../../../../../lib/apiErrors';

const requireAdmin = vi.fn();
vi.mock('../../../../../../../lib/auth', () => ({ requireAdmin }));

const guardAnnouncement = vi.fn();
const releaseAnnouncement = vi.fn();
vi.mock('../../../../../../../lib/announcementGuard', () => ({ guardAnnouncement, releaseAnnouncement }));

const sendEmail = vi.fn();
vi.mock('../../../../../../../lib/gmail', () => ({ sendEmail }));

const store = createFakeStore();
vi.mock('../../../../../../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../../../../../../sheets/signups', () => fakeSignupsModule(store));

const { POST } = await import('../route');
const { listSignupsForSession } = await import('../../../../../../../sheets/signups');

const SESSION = '2026-07-10';

function post(body: Record<string, unknown>) {
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ sessionId: SESSION }) });
}

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(undefined);
  guardAnnouncement.mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-07T18:00:00.000Z')); // Tuesday, registration closed
  store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, gameTime: '18:00', capacity: 20 }));
  store.signups.set('s1', makeSignup({ signupId: 's1', sessionId: SESSION, status: 'confirmed' }));
});

describe('POST practice-poll', () => {
  // The poll used to be saved open before the cooldown was checked, so a
  // refused send left it open with nobody told.
  it('leaves the poll as it was when the send is refused', async () => {
    guardAnnouncement.mockRejectedValue(new ApiError(429, 'That was just sent.'));

    const res = await post({ status: 'open', notify: true });

    expect(res.status).toBe(429);
    expect(store.sessions.get(SESSION)?.practicePollStatus).toBe('');
  });

  // Nothing was emailed, so the minute is given back: a retry must not be
  // told "That was just sent".
  it('gives the cooldown back when the send fails before anyone is emailed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(listSignupsForSession).mockRejectedValueOnce(new Error('quota'));

    const res = await post({ status: 'open', notify: true });

    expect(res.status).toBe(500);
    expect(releaseAnnouncement).toHaveBeenCalledWith('practice-poll', SESSION);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('opens quietly without touching the cooldown', async () => {
    const res = await post({ status: 'open', notify: false });

    expect(res.status).toBe(200);
    expect(guardAnnouncement).not.toHaveBeenCalled();
    expect(store.sessions.get(SESSION)?.practicePollStatus).toBe('open');
  });
});
