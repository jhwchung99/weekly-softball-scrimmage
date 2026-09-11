import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, resetFakeStore, makeSession, makeSignup } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));

const sendEmail = vi.fn();
vi.mock('../../lib/gmail', () => ({ sendEmail }));

const { notifySessionChange, nudgeUnpaidPlayers } = await import('../announcements');

// The game is 6pm ET on 2099-01-01, so the roster locks (and payment opens)
// at 1pm ET — 18:00Z, since January is EST.
const SESSION_ID = '2099-01-01';
const BEFORE_LOCK = new Date('2099-01-01T15:00:00.000Z'); // 10am ET
const AFTER_LOCK = new Date('2099-01-01T20:00:00.000Z'); // 3pm ET

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  sendEmail.mockResolvedValue(undefined);
  // Full fake timers, so the SEND_GAP_MS pause between sends is drained by
  // runAllTimersAsync instead of costing the suite half a second per
  // recipient. `now` is passed explicitly everywhere that it matters.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Drives a fan-out to completion past its inter-send delays. */
async function drain<T>(started: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return started;
}

function seed(sessionOverrides = {}, signups: ReturnType<typeof makeSignup>[] = []) {
  store.sessions.set(SESSION_ID, makeSession({ sessionId: SESSION_ID, gameDate: SESSION_ID, ...sessionOverrides }));
  for (const s of signups) store.signups.set(s.signupId, s);
}

/** The `to` address of every send, in order. */
function sentTo(): string[] {
  return sendEmail.mock.calls.map((call) => call[0]);
}

/** The body of the send to one address. */
function bodyFor(email: string): string {
  const call = sendEmail.mock.calls.find((c) => c[0] === email);
  return call ? call[2] : '';
}

describe('notifySessionChange', () => {
  it('emails confirmed players the current details, and leaves the waitlist alone', async () => {
    seed({ locationName: 'Iceland Diamond 3', locationArea: 'Mississauga' }, [
      makeSignup({ signupId: 'a', email: 'in@dummy.test', fullName: 'In', status: 'confirmed' }),
      makeSignup({ signupId: 'b', email: 'waiting@dummy.test', fullName: 'Waiting', status: 'waitlisted' }),
    ]);

    const result = await drain(notifySessionChange(SESSION_ID, ''));

    expect(result).toMatchObject({ skipped: false, sent: 1, failed: 0, recipients: ['In'] });
    expect(sentTo()).toEqual(['in@dummy.test']);
    // The whole point of the button: the details a player needs on Thursday.
    expect(bodyFor('in@dummy.test')).toContain('Iceland Diamond 3, Mississauga');
    // Players read "6pm", not "18:00" — see docs/voice.md.
    expect(bodyFor('in@dummy.test')).toContain('6pm');
  });

  it('emails the waitlist too when the session is cancelled, because there is no spot left to wait for', async () => {
    seed({ status: 'cancelled' }, [
      makeSignup({ signupId: 'a', email: 'in@dummy.test', fullName: 'In', status: 'confirmed' }),
      makeSignup({ signupId: 'b', email: 'waiting@dummy.test', fullName: 'Waiting', status: 'waitlisted' }),
    ]);

    const result = await drain(notifySessionChange(SESSION_ID, ''));

    expect(result.sent).toBe(2);
    expect(sentTo().sort()).toEqual(['in@dummy.test', 'waiting@dummy.test']);
    expect(bodyFor('waiting@dummy.test')).toMatch(/has been cancelled/);
    expect(bodyFor('waiting@dummy.test')).toMatch(/Don't head to the field/);
  });

  it('never writes to someone who already cancelled their own signup', async () => {
    seed({ status: 'cancelled' }, [
      makeSignup({ signupId: 'a', email: 'gone@dummy.test', status: 'cancelled' }),
    ]);

    const result = await drain(notifySessionChange(SESSION_ID, ''));

    expect(result).toMatchObject({ skipped: true, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("includes the organizer's note verbatim", async () => {
    seed({}, [makeSignup({ signupId: 'a', email: 'in@dummy.test', status: 'confirmed' })]);

    await drain(notifySessionChange(SESSION_ID, 'The city double-booked diamond 3.'));

    expect(bodyFor('in@dummy.test')).toContain('The city double-booked diamond 3.');
  });

  it('skips with a reason rather than failing when nobody is signed up', async () => {
    seed();

    const result = await drain(notifySessionChange(SESSION_ID, ''));

    expect(result).toMatchObject({ skipped: true, sent: 0, recipients: [] });
    expect(result.reason).toMatch(/nobody is signed up/i);
  });

  it('reports a missing session instead of throwing', async () => {
    const result = await drain(notifySessionChange('2099-12-25', ''));

    expect(result).toMatchObject({ skipped: true, sent: 0 });
    expect(result.reason).toMatch(/no session/i);
  });

  it('keeps going past a failed send, so one bad address cannot truncate the list', async () => {
    seed({}, [
      makeSignup({ signupId: 'a', email: 'first@dummy.test', fullName: 'First', status: 'confirmed' }),
      makeSignup({ signupId: 'b', email: 'bad@dummy.test', fullName: 'Bad', status: 'confirmed' }),
      makeSignup({ signupId: 'c', email: 'third@dummy.test', fullName: 'Third', status: 'confirmed' }),
    ]);
    sendEmail.mockImplementation(async (to: string) => {
      if (to === 'bad@dummy.test') throw new Error('550 no such mailbox');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await drain(notifySessionChange(SESSION_ID, ''));

    expect(result).toMatchObject({ sent: 2, failed: 1, recipients: ['First', 'Third'] });
    expect(sentTo()).toContain('third@dummy.test');
  });
});

describe('nudgeUnpaidPlayers', () => {
  const unpaid = () =>
    makeSignup({ signupId: 'a', email: 'owes@dummy.test', fullName: 'Owes', status: 'confirmed', paid: false });

  it('emails only the confirmed players who still owe', async () => {
    seed({ pricePerSpot: 10 }, [
      unpaid(),
      makeSignup({ signupId: 'b', email: 'settled@dummy.test', status: 'confirmed', paid: true, amountPaid: 10 }),
      makeSignup({ signupId: 'c', email: 'waiting@dummy.test', status: 'waitlisted' }),
      makeSignup({ signupId: 'd', email: 'gone@dummy.test', status: 'cancelled' }),
    ]);

    const result = await drain(nudgeUnpaidPlayers(SESSION_ID, AFTER_LOCK));

    expect(result).toMatchObject({ skipped: false, sent: 1, recipients: ['Owes'] });
    expect(sentTo()).toEqual(['owes@dummy.test']);
    expect(bodyFor('owes@dummy.test')).toContain('$10.00');
  });

  it('asks for the money once the roster has locked', async () => {
    seed({ pricePerSpot: 10 }, [unpaid()]);

    await drain(nudgeUnpaidPlayers(SESSION_ID, AFTER_LOCK));

    expect(bodyFor('owes@dummy.test')).toMatch(/costs \$10\.00/);
    expect(bodyFor('owes@dummy.test')).toMatch(/send it before the game/i);
  });

  it('does not say "still owe", which assumes an earlier ask that may not have happened', async () => {
    // A morning game locks its roster before the 9am reminder cron fires, so
    // that email takes this branch too — and anyone promoted off the waitlist
    // after it went out never saw the other one either. For both of them this
    // is the first time the app has mentioned money.
    seed({ pricePerSpot: 10 }, [unpaid()]);

    await drain(nudgeUnpaidPlayers(SESSION_ID, AFTER_LOCK));

    expect(bodyFor('owes@dummy.test')).not.toMatch(/still/i);
  });

  it('says when payment opens rather than asking for it early', async () => {
    seed({ pricePerSpot: 10 }, [unpaid()]);

    await drain(nudgeUnpaidPlayers(SESSION_ID, BEFORE_LOCK));

    const body = bodyFor('owes@dummy.test');
    expect(body).toMatch(/Payment opens at 1pm/);
    expect(body).not.toMatch(/still owe/);
  });

  it('bills two people sharing a spot half each, like every other payment path', async () => {
    seed({ pricePerSpot: 10 }, [
      makeSignup({ signupId: 'a', email: 'one@dummy.test', fullName: 'One', status: 'confirmed', pairId: 'p1' }),
      makeSignup({ signupId: 'b', email: 'two@dummy.test', fullName: 'Two', status: 'confirmed', pairId: 'p1' }),
    ]);

    const result = await drain(nudgeUnpaidPlayers(SESSION_ID, AFTER_LOCK));

    expect(result.sent).toBe(2);
    expect(bodyFor('one@dummy.test')).toContain('$5.00');
    expect(bodyFor('two@dummy.test')).toContain('$5.00');
  });

  it('skips when the session has no price set, so nobody is told they owe $0', async () => {
    seed({ pricePerSpot: 0 }, [unpaid()]);

    const result = await drain(nudgeUnpaidPlayers(SESSION_ID, AFTER_LOCK));

    expect(result).toMatchObject({ skipped: true, sent: 0 });
    expect(result.reason).toMatch(/no price per spot/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips when nobody on the confirmed roster still owes anything', async () => {
    seed({ pricePerSpot: 10 }, [
      makeSignup({ signupId: 'a', email: 'settled@dummy.test', status: 'confirmed', paid: true, amountPaid: 10 }),
    ]);

    const result = await drain(nudgeUnpaidPlayers(SESSION_ID, AFTER_LOCK));

    expect(result).toMatchObject({ skipped: true, sent: 0 });
    expect(result.reason).toMatch(/still owes anything/i);
  });
});
