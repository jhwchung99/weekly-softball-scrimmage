import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, resetFakeStore, makeSession, makeSignup } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));

const sendPush = vi.fn();
vi.mock('../../lib/ntfy', () => ({ sendPush }));
const sendEmail = vi.fn();
vi.mock('../../lib/gmail', () => ({ sendEmail }));

const { setPracticePollStatus, setSessionFormat, answerPracticePoll } = await import('../practicePollFlow');
const { closeRegistrationForCurrentSession } = await import('../scheduling');

const SESSION_ID = '2026-07-10';
const TUESDAY_MIDNIGHT = new Date('2026-07-07T04:00:00.000Z');

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  sendPush.mockResolvedValue(undefined);
  sendEmail.mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  // Well before the game, so nothing is refused for having been played.
  vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function seed(sessionOverrides = {}, signups: ReturnType<typeof makeSignup>[] = []) {
  store.sessions.set(
    SESSION_ID,
    makeSession({ sessionId: SESSION_ID, gameDate: SESSION_ID, status: 'open', ...sessionOverrides })
  );
  for (const s of signups) store.signups.set(s.signupId, s);
}

/** `count` confirmed signups on this session, each holding their own spot. */
const roster = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    makeSignup({ signupId: `s${i}`, sessionId: SESSION_ID, email: `p${i}@dummy.test`, status: 'confirmed' })
  );

describe('setPracticePollStatus', () => {
  it('opens a poll on a light week', async () => {
    seed({}, roster(10));

    const session = await setPracticePollStatus(SESSION_ID, 'open', '2026-07-09T22:00:00.000Z');

    expect(session.practicePollStatus).toBe('open');
    expect(session.practicePollClosesAt).toBe('2026-07-09T22:00:00.000Z');
  });

  it('refuses to open one on a week that has enough players', async () => {
    // The dashboard hides the button above the threshold, but the button is
    // not the rule: a stale tab is enough to press one that should be gone.
    seed({}, roster(16));

    await expect(setPracticePollStatus(SESSION_ID, 'open')).rejects.toThrow(/light week/i);
    expect(store.sessions.get(SESSION_ID)?.practicePollStatus).toBe('');
  });

  it('respects a threshold the session set for itself', async () => {
    seed({ practicePollThreshold: 20 }, roster(18));

    const session = await setPracticePollStatus(SESSION_ID, 'open');
    expect(session.practicePollStatus).toBe('open');
  });

  it('closes without checking the threshold, so a recovered week can still be closed', async () => {
    seed({ practicePollStatus: 'open' }, roster(20));

    const session = await setPracticePollStatus(SESSION_ID, 'closed');
    expect(session.practicePollStatus).toBe('closed');
  });

  it('sends nothing on its own', async () => {
    // The email is the route's doing and the organizer's checkbox. Closing a
    // poll mails nobody at all.
    seed({}, roster(10));

    await setPracticePollStatus(SESSION_ID, 'open');
    await setPracticePollStatus(SESSION_ID, 'closed');

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses on a cancelled week', async () => {
    seed({ status: 'cancelled' }, roster(5));
    await expect(setPracticePollStatus(SESSION_ID, 'open')).rejects.toThrow(/cancelled/i);
  });
});

describe('setSessionFormat', () => {
  it('marks a week as practice and back again', async () => {
    seed({}, roster(8));

    expect((await setSessionFormat(SESSION_ID, 'practice')).format).toBe('practice');
    expect((await setSessionFormat(SESSION_ID, 'game')).format).toBe('game');
  });

  it('mails nobody', async () => {
    seed({}, roster(8));
    await setSessionFormat(SESSION_ID, 'practice');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses on a cancelled week', async () => {
    seed({ status: 'cancelled' }, roster(8));
    await expect(setSessionFormat(SESSION_ID, 'practice')).rejects.toThrow(/cancelled/i);
  });
});

/**
 * The bug the `format` column exists to avoid, named so it cannot be quietly
 * reintroduced by folding practice into `status`.
 *
 * `closeRegistration` skips any session whose status is not 'open'. Had
 * practice been a fourth status value, marking a week on Monday evening would
 * make Tuesday's cron refuse to close it: no registrationClosesAt, no
 * headcount push, and a phase that never advances. See ADR-0007.
 */
describe('a practice week still closes registration on schedule', () => {
  it('closes normally after being marked as practice while registration was open', async () => {
    store.sessions.set(
      '2026-07-12',
      makeSession({ sessionId: '2026-07-12', gameDate: '2026-07-12', status: 'open' })
    );

    await setSessionFormat('2026-07-12', 'practice');
    // Still open for signups, and still a practice week.
    expect(store.sessions.get('2026-07-12')?.status).toBe('open');
    expect(store.sessions.get('2026-07-12')?.format).toBe('practice');

    const result = await closeRegistrationForCurrentSession(TUESDAY_MIDNIGHT);

    expect(result.skipped).toBe(false);
    expect(store.sessions.get('2026-07-12')?.status).toBe('closed');
    expect(store.sessions.get('2026-07-12')?.registrationClosesAt).not.toBe('');
    // And the format survived the close.
    expect(store.sessions.get('2026-07-12')?.format).toBe('practice');
  });
});

describe('answerPracticePoll', () => {
  const ME = 'me@dummy.test';
  const mine = (over = {}) =>
    makeSignup({ signupId: 'mine', sessionId: SESSION_ID, email: ME, status: 'confirmed', ...over });

  it('records an answer', async () => {
    seed({ practicePollStatus: 'open' }, [mine()]);

    const saved = await answerPracticePoll(SESSION_ID, ME, 'yes');

    expect(saved.practicePollAnswer).toBe('yes');
    expect(saved.practicePollAnsweredAt).not.toBe('');
  });

  it('lets a player change their mind while the poll is open', async () => {
    seed({ practicePollStatus: 'open' }, [mine({ practicePollAnswer: 'no' })]);

    const saved = await answerPracticePoll(SESSION_ID, ME, 'yes');
    expect(saved.practicePollAnswer).toBe('yes');
  });

  it('matches the caller by normalized email, so casing cannot lock them out', async () => {
    seed({ practicePollStatus: 'open' }, [mine()]);

    const saved = await answerPracticePoll(SESSION_ID, 'ME@Dummy.Test', 'no');
    expect(saved.practicePollAnswer).toBe('no');
  });

  it('refuses once the poll is closed, which is what makes the panel read-only', async () => {
    seed({ practicePollStatus: 'closed' }, [mine()]);

    await expect(answerPracticePoll(SESSION_ID, ME, 'yes')).rejects.toThrow(/not taking answers/i);
  });

  it('refuses when no poll was ever opened', async () => {
    seed({}, [mine()]);
    await expect(answerPracticePoll(SESSION_ID, ME, 'yes')).rejects.toThrow(/not taking answers/i);
  });

  it('refuses a waitlisted player', async () => {
    // Only the people who would turn up are asked.
    seed({ practicePollStatus: 'open' }, [mine({ status: 'waitlisted' })]);

    await expect(answerPracticePoll(SESSION_ID, ME, 'yes')).rejects.toThrow(/not taking answers/i);
  });

  it('refuses someone with no signup for this week', async () => {
    seed({ practicePollStatus: 'open' }, [mine()]);

    await expect(answerPracticePoll(SESSION_ID, 'stranger@dummy.test', 'yes')).rejects.toThrow(/not signed up/i);
  });

  it('never writes to somebody else’s row', async () => {
    const other = makeSignup({
      signupId: 'other',
      sessionId: SESSION_ID,
      email: 'other@dummy.test',
      status: 'confirmed',
    });
    seed({ practicePollStatus: 'open' }, [mine(), other]);

    await answerPracticePoll(SESSION_ID, ME, 'yes');

    expect(store.signups.get('other')?.practicePollAnswer).toBe('');
  });
});
