import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));

const sendPush = vi.fn();
vi.mock('../../lib/ntfy', () => ({ sendPush }));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));

const { openRegistrationForUpcomingSession, closeRegistrationForCurrentSession } = await import('../scheduling');
const { signUpForSession } = await import('../signupFlow');

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  sendPush.mockResolvedValue(undefined);
});

// 2026-07-06T13:00:00Z is 9:00am EDT on Monday 2026-07-06; that week's
// Fri/Sat/Sun are 07-10/07-11/07-12 (see time.test.ts for the same dates).
const MONDAY_9AM = new Date('2026-07-06T13:00:00.000Z');
// 2026-07-07T04:00:00Z is 12:00am EDT on Tuesday 2026-07-07 — same instant
// as the Tuesday-close case in time.test.ts.
const TUESDAY_MIDNIGHT = new Date('2026-07-07T04:00:00.000Z');

describe('openRegistrationForUpcomingSession', () => {
  it('creates a default Friday session when nothing exists yet for the week', async () => {
    const result = await openRegistrationForUpcomingSession(MONDAY_9AM);

    expect(result).toEqual({ sessionId: '2026-07-10', skipped: false });
    expect(store.sessions.get('2026-07-10')).toMatchObject({ gameDate: '2026-07-10', status: 'open' });
  });

  it('opens the already-scheduled Saturday session instead of creating a duplicate Friday one', async () => {
    store.sessions.set('2026-07-11', makeSession({ sessionId: '2026-07-11', gameDate: '2026-07-11', status: 'closed' }));

    const result = await openRegistrationForUpcomingSession(MONDAY_9AM);

    expect(result).toEqual({ sessionId: '2026-07-11', skipped: false });
    expect(store.sessions.get('2026-07-11')?.status).toBe('open');
    expect(store.sessions.has('2026-07-10')).toBe(false); // no default Friday row created alongside it
  });

  it('skips without touching the sheet when not near 9am ET (DST-offset duplicate firing)', async () => {
    const result = await openRegistrationForUpcomingSession(new Date('2026-07-06T14:00:00.000Z'));

    expect(result.skipped).toBe(true);
    expect(store.sessions.size).toBe(0);
  });
});

describe('closeRegistrationForCurrentSession', () => {
  it("closes whichever of Friday/Saturday/Sunday has this week's session", async () => {
    store.sessions.set('2026-07-12', makeSession({ sessionId: '2026-07-12', gameDate: '2026-07-12', status: 'open' }));

    const result = await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    expect(result).toEqual({ sessionId: '2026-07-12', skipped: false });
    expect(store.sessions.get('2026-07-12')?.status).toBe('closed');
  });

  it('skips when no session exists for the week under any of the three candidates', async () => {
    const result = await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);
    expect(result).toEqual({ sessionId: '2026-07-10', skipped: true, reason: expect.stringMatching(/no session exists/i) });
  });

  it('skips without touching the sheet when not near 12am ET (DST-offset duplicate firing)', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', status: 'open' }));

    // 1 hour after the real 12am ET instant — the seasonal EST/EDT duplicate.
    const result = await closeRegistrationForCurrentSession(new Date('2026-07-07T05:00:00.000Z'));

    expect(result.skipped).toBe(true);
    expect(store.sessions.get('2026-07-10')?.status).toBe('open');
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('alerts the organizer when capacity still has room after closing', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 5, status: 'open' }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await signUpForSession('2026-07-10', 'a@dummy.test', true);

    await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(expect.stringContaining('4 open spots'), expect.stringContaining('2026-07-10'));
  });

  it('does not alert the organizer when capacity is already full', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 1, status: 'open' }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await signUpForSession('2026-07-10', 'a@dummy.test', true);

    await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('still reports a successful close even if the organizer alert fails to send', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 5, status: 'open' }));
    sendPush.mockRejectedValue(new Error('ntfy down'));

    const result = await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    expect(result).toEqual({ sessionId: '2026-07-10', skipped: false });
    expect(store.sessions.get('2026-07-10')?.status).toBe('closed');
  });
});
