import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer , duringRegistration} from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));

const sendPush = vi.fn();
vi.mock('../../lib/ntfy', () => ({ sendPush }));
const sendEmail = vi.fn();
vi.mock('../../lib/gmail', () => ({ sendEmail }));

const { openRegistrationForUpcomingSession, closeRegistrationForCurrentSession, sendRemindersForSession } = await import('../scheduling');
const { signUpForSession } = await import('../signupFlow');

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  sendPush.mockResolvedValue(undefined);
  // Player signups are gated on the registration window now, so these
  // run at a fixed instant inside it rather than at whatever time the
  // suite happens to be run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(duringRegistration('2026-07-10'));
});

afterEach(() => {
  vi.useRealTimers();
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

  it('discards the DST-offset duplicate firing because the session is no longer open', async () => {
    // The real firing already closed it; this is the seasonal duplicate an
    // hour later. Rejected on state, not on the clock — which is what makes
    // it safe for either firing to be the one that arrives first.
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', status: 'closed' }));

    const result = await closeRegistrationForCurrentSession(new Date('2026-07-07T05:00:00.000Z'));

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/already closed/i);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('still closes when GitHub Actions fires hours late', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', status: 'open' }));

    // 5am ET — five hours past the intended midnight close. The old
    // clock-window guard skipped this, which is why registration silently
    // never closed; delays this long are routine on GitHub's scheduler.
    const result = await closeRegistrationForCurrentSession(new Date('2026-07-07T09:00:00.000Z'));

    expect(result).toEqual({ sessionId: '2026-07-10', skipped: false });
    expect(store.sessions.get('2026-07-10')?.status).toBe('closed');
    expect(sendPush).toHaveBeenCalled();
  });

  it("does not close early when the week's close time hasn't arrived yet", async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', status: 'open' }));

    const result = await closeRegistrationForCurrentSession(MONDAY_9AM);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/does not close until/i);
    expect(store.sessions.get('2026-07-10')?.status).toBe('open');
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('alerts the organizer when capacity still has room after closing', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 5, status: 'open' }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await signUpForSession('2026-07-10', 'a@dummy.test', true);

    await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    // Two now: the headcount, which always goes out, and the open-spots nudge.
    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenCalledWith(
      expect.stringContaining('4 open spots'),
      expect.stringContaining('Friday, July 10')
    );
  });

  it('does not alert the organizer when capacity is already full', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 1, status: 'open' }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await signUpForSession('2026-07-10', 'a@dummy.test', true);

    await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    // The open-spots nudge stays silent, but the headcount still goes out:
    // a full session is exactly when a second field is worth considering.
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(
      expect.stringContaining('1 playing'),
      expect.stringContaining('1 of 1 spots filled'),
      expect.anything()
    );
  });

  it('still reports a successful close even if the organizer alert fails to send', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 5, status: 'open' }));
    sendPush.mockRejectedValue(new Error('ntfy down'));

    const result = await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    expect(result).toEqual({ sessionId: '2026-07-10', skipped: false });
    expect(store.sessions.get('2026-07-10')?.status).toBe('closed');
  });
});

describe('sendRemindersForSession', () => {
  // For an 18:00 game the roster locks at 1pm ET. 2026-07-10T18:00:00Z is 2pm
  // EDT on game day: past the lock, so the amount owed is final.
  const AFTER_LOCK = new Date('2026-07-10T18:00:00.000Z');
  const BEFORE_LOCK = new Date('2026-07-10T13:00:00.000Z'); // 9am ET

  async function seed(overrides: Record<string, unknown> = {}, players = ['a']) {
    store.sessions.set(
      '2026-07-10',
      makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00', capacity: 5, status: 'open', ...overrides })
    );
    for (const n of players) {
      store.players.set(`${n}@dummy.test`, makePlayer({ email: `${n}@dummy.test`, fullName: n.toUpperCase() }));
      await signUpForSession('2026-07-10', `${n}@dummy.test`, true);
    }
  }

  it('emails every confirmed player, with what they owe', async () => {
    await seed({ pricePerSpot: 10 }, ['a', 'b']);

    const result = await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    expect(result).toMatchObject({ sessionId: '2026-07-10', skipped: false, sent: 2, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith('a@dummy.test', expect.stringContaining('today at'), expect.stringContaining('$10.00'));
  });

  it('names the field, not just links it', async () => {
    // This is the email someone opens in the car, and a bare URL is no use to
    // a passenger reading it aloud.
    await seed({ locationName: 'Iceland Diamond 3', locationArea: 'Mississauga', locationUrl: 'https://maps.example.test/x' });

    await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    const body = sendEmail.mock.calls[0][2] as string;
    expect(body).toContain('Iceland Diamond 3, Mississauga');
    expect(body).toContain('https://maps.example.test/x');
  });

  it('asks for payment outright, because the lock has passed', async () => {
    // The whole reason the send is gated on the lock: after it, the figure is
    // final, so the email states it rather than explaining when it will exist.
    await seed({ pricePerSpot: 10 });

    await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    const body = sendEmail.mock.calls[0][2] as string;
    expect(body).toContain('Please send it before the game.');
    expect(body).not.toMatch(/payment opens/i);
  });

  it('refuses to send before the roster locks, naming when that is', async () => {
    await seed({ pricePerSpot: 10 });

    await expect(sendRemindersForSession('2026-07-10', BEFORE_LOCK)).rejects.toThrow(/has not locked yet/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends the night before when the session locks the night before', async () => {
    // An early game: 10am Saturday, locked at 8pm on the Friday. The organizer
    // sends it Friday evening and nothing happens on game day at all.
    store.sessions.set(
      '2026-07-11',
      makeSession({
        sessionId: '2026-07-11',
        gameDate: '2026-07-11',
        gameTime: '10:00',
        capacity: 5,
        pricePerSpot: 10,
        status: 'open',
        rosterLockAt: '2026-07-11T00:00:00.000Z', // 8pm ET Friday
      })
    );
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await signUpForSession('2026-07-11', 'a@dummy.test', true);

    const fridayEvening = new Date('2026-07-11T01:00:00.000Z'); // 9pm ET Friday
    const result = await sendRemindersForSession('2026-07-11', fridayEvening);

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    const [, subject, body] = sendEmail.mock.calls[0] as [string, string, string];
    expect(subject).toContain('tomorrow at 10am');
    expect(body).toContain('tomorrow at 10am');
    expect(body).toContain('Please send it before the game.');
  });

  it('records when the email went out, so the dashboard still knows hours later', async () => {
    await seed({ pricePerSpot: 10 });

    await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    expect(store.sessions.get('2026-07-10')?.remindersSentAt).toBe(AFTER_LOCK.toISOString());
  });

  it('leaves remindersSentAt alone when every address failed', async () => {
    await seed({ pricePerSpot: 10 });
    // Once, not for every call: a persistent rejection outlives clearAllMocks
    // and would fail the next test instead of this one.
    sendEmail.mockRejectedValueOnce(new Error('gmail down'));

    const result = await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(store.sessions.get('2026-07-10')?.remindersSentAt).toBe('');
  });

  it('asks players to tell the organizer, not to expect an automatic replacement', async () => {
    // After the lock the waitlist no longer promotes on its own, so the old
    // "someone will take your spot" wording promised a handover that does not
    // happen. Capacity 1, two signups: 'b' lands on the waitlist.
    await seed({ capacity: 1 }, ['a', 'b']);

    await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const body = sendEmail.mock.calls[0][2] as string;
    expect(body).toContain('let the organizer know');
    expect(body).not.toMatch(/waitlist can take your spot/i);
  });

  it('leaves the cancel nudge out when the waitlist is empty', async () => {
    await seed();

    await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][2]).not.toMatch(/waitlist/i);
    expect(sendEmail.mock.calls[0][2]).not.toMatch(/cancel/i);
  });

  it('refuses a cancelled session', async () => {
    // Cancelled after the signups, because signing up for a cancelled week is
    // itself refused.
    await seed();
    store.sessions.set('2026-07-10', { ...store.sessions.get('2026-07-10')!, status: 'cancelled' });

    await expect(sendRemindersForSession('2026-07-10', AFTER_LOCK)).rejects.toThrow(/cancelled/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses once the game has started', async () => {
    await seed();

    const afterFirstPitch = new Date('2026-07-10T23:00:00.000Z'); // 7pm ET
    await expect(sendRemindersForSession('2026-07-10', afterFirstPitch)).rejects.toThrow(/already started/i);
  });

  it('keeps going when one address fails', async () => {
    await seed({}, ['a', 'b']);
    sendEmail.mockRejectedValueOnce(new Error('bad address'));

    const result = await sendRemindersForSession('2026-07-10', AFTER_LOCK);

    expect(result).toMatchObject({ sent: 1, failed: 1 });
  });
});
