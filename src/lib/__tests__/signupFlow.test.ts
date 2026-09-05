import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer, makeSignup } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

// See src/lib/__tests__/subRequestFlow.test.ts for notes on why the
// store shape is inlined here rather than calling the imported
// createFakeStore() — vi.hoisted runs before this file's own imports
// are linked.
const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));

const sendEmail = vi.fn();
const sendPush = vi.fn();
vi.mock('../../lib/gmail', () => ({ sendEmail }));
vi.mock('../../lib/ntfy', () => ({ sendPush }));

const { signUpForSession, signUpAsGuestForSession, cancelMySignup, countConfirmedSlots, computeCostShare, computePaymentSummary } = await import('../signupFlow');

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('countConfirmedSlots', () => {
  it('counts each solo confirmed signup as one slot', () => {
    const signups = [
      { ...makeSignup(), signupId: '1', status: 'confirmed' as const, pairId: '' },
      { ...makeSignup(), signupId: '2', status: 'confirmed' as const, pairId: '' },
    ];
    expect(countConfirmedSlots(signups)).toBe(2);
  });

  it('counts a confirmed pair as one slot regardless of row count', () => {
    const signups = [
      { ...makeSignup(), signupId: '1', status: 'confirmed' as const, pairId: 'pair-a' },
      { ...makeSignup(), signupId: '2', status: 'confirmed' as const, pairId: 'pair-a' },
    ];
    expect(countConfirmedSlots(signups)).toBe(1);
  });

  it('ignores waitlisted and cancelled rows', () => {
    const signups = [
      { ...makeSignup(), signupId: '1', status: 'waitlisted' as const },
      { ...makeSignup(), signupId: '2', status: 'cancelled' as const },
    ];
    expect(countConfirmedSlots(signups)).toBe(0);
  });
});

describe('computeCostShare', () => {
  it('returns {} when no price is set', () => {
    expect(computeCostShare(makeSession({ pricePerSpot: 0 }), [])).toEqual({});
  });

  it('charges every solo confirmed player the same fixed price', () => {
    const signups = [
      makeSignup({ signupId: '1', status: 'confirmed', pairId: '' }),
      makeSignup({ signupId: '2', status: 'confirmed', pairId: '' }),
    ];
    const shares = computeCostShare(makeSession({ pricePerSpot: 10 }), signups);
    expect(shares['1']).toBe(10);
    expect(shares['2']).toBe(10);
  });

  it('does not change the price when the roster size changes', () => {
    const two = [
      makeSignup({ signupId: '1', status: 'confirmed' }),
      makeSignup({ signupId: '2', status: 'confirmed' }),
    ];
    const five = [...two, ...['3', '4', '5'].map((id) => makeSignup({ signupId: id, status: 'confirmed' }))];
    const session = makeSession({ pricePerSpot: 10 });

    // The whole point of a fixed price: someone who paid on Wednesday still
    // owes exactly what they paid on Friday.
    expect(computeCostShare(session, two)['1']).toBe(10);
    expect(computeCostShare(session, five)['1']).toBe(10);
  });

  it('splits one spot between the two people sharing it', () => {
    const signups = [
      makeSignup({ signupId: '1', status: 'confirmed', pairId: 'p' }),
      makeSignup({ signupId: '2', status: 'confirmed', pairId: 'p' }),
    ];
    const shares = computeCostShare(makeSession({ pricePerSpot: 10 }), signups);
    expect(shares['1']).toBe(5);
    expect(shares['2']).toBe(5);
  });

  it('rounds an odd split to the nearest cent', () => {
    const signups = [
      makeSignup({ signupId: '1', status: 'confirmed', pairId: 'p' }),
      makeSignup({ signupId: '2', status: 'confirmed', pairId: 'p' }),
    ];
    const shares = computeCostShare(makeSession({ pricePerSpot: 12.35 }), signups);
    expect(shares['1']).toBe(6.18); // 6.175 -> 6.18
  });

  it('ignores waitlisted and cancelled players', () => {
    const signups = [
      makeSignup({ signupId: '1', status: 'confirmed' }),
      makeSignup({ signupId: '2', status: 'waitlisted' }),
      makeSignup({ signupId: '3', status: 'cancelled' }),
    ];
    const shares = computeCostShare(makeSession({ pricePerSpot: 10 }), signups);
    expect(Object.keys(shares)).toEqual(['1']);
  });
});

describe('computePaymentSummary', () => {
  it('reports expected, collected, and surplus against the permit', () => {
    const signups = [
      makeSignup({ signupId: '1', status: 'confirmed', paid: true, amountPaid: 10 }),
      makeSignup({ signupId: '2', status: 'confirmed', paid: true, amountPaid: 10 }),
      makeSignup({ signupId: '3', status: 'confirmed', paid: false }),
    ];
    const summary = computePaymentSummary(makeSession({ pricePerSpot: 10, cost: 25 }), signups);

    expect(summary).toEqual({ expected: 30, collected: 20, permitCost: 25, surplus: -5, unpaidCount: 1 });
  });

  it('still counts money from someone who paid and then cancelled', () => {
    const signups = [
      makeSignup({ signupId: '1', status: 'confirmed', paid: true, amountPaid: 10 }),
      makeSignup({ signupId: '2', status: 'cancelled', paid: true, amountPaid: 10 }),
    ];
    const summary = computePaymentSummary(makeSession({ pricePerSpot: 10, cost: 15 }), signups);

    expect(summary.collected).toBe(20); // payments are never refunded
    expect(summary.expected).toBe(10); // but a cancelled player isn't owed against
    expect(summary.surplus).toBe(5);
  });
});

describe('signUpForSession', () => {
  it('confirms when under capacity and waitlists once full', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 1 }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    store.players.set('b@dummy.test', makePlayer({ email: 'b@dummy.test' }));

    const first = await signUpForSession('2099-01-01', 'a@dummy.test', true);
    const second = await signUpForSession('2099-01-01', 'b@dummy.test', true);
    expect(first.status).toBe('confirmed');
    expect(second.status).toBe('waitlisted');
  });

  it('rejects a duplicate active signup for the same session', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await signUpForSession('2099-01-01', 'a@dummy.test', true);
    await expect(signUpForSession('2099-01-01', 'a@dummy.test', true)).rejects.toThrow(/already signed up/);
  });

  it('requires a player profile to exist first', async () => {
    store.sessions.set('2099-01-01', makeSession());
    await expect(signUpForSession('2099-01-01', 'nobody@dummy.test', true)).rejects.toThrow(/PROFILE_REQUIRED/);
  });

  it('rejects signup when the session is not open', async () => {
    store.sessions.set('2099-01-01', makeSession({ status: 'closed' }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    await expect(signUpForSession('2099-01-01', 'a@dummy.test', true)).rejects.toThrow(/not currently open/);
  });

  it('merges with a pending guest invite that named this member (guest signed up first)', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member One' }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest One' }));

    const guest = await signUpAsGuestForSession('2099-01-01', 'guest@dummy.test', 'Member One', true, true);
    expect(guest.pairId).toBe(''); // member hasn't signed up yet

    const member = await signUpForSession('2099-01-01', 'member@dummy.test', true);
    expect(member.pairId).toBeTruthy();

    const guestRow = store.signups.get(guest.signupId);
    expect(guestRow?.pairId).toBe(member.pairId);
  });
});

describe('cancelMySignup', () => {
  it('rejects cancelling someone else\'s signup without admin rights (IDOR check)', async () => {
    store.sessions.set('2099-01-01', makeSession());
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    const signup = await signUpForSession('2099-01-01', 'a@dummy.test', true);

    await expect(cancelMySignup(signup.signupId, 'someone-else@dummy.test', false)).rejects.toThrow(/only cancel your own/);
  });

  it('allows an admin to cancel someone else\'s signup', async () => {
    store.sessions.set('2099-01-01', makeSession());
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    const signup = await signUpForSession('2099-01-01', 'a@dummy.test', true);

    const result = await cancelMySignup(signup.signupId, 'admin@dummy.test', true);
    expect(result).toBeTruthy();
    expect(store.signups.get(signup.signupId)?.status).toBe('cancelled');
  });

  it('is a no-op on an already-cancelled signup', async () => {
    store.sessions.set('2099-01-01', makeSession());
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    const signup = await signUpForSession('2099-01-01', 'a@dummy.test', true);
    await cancelMySignup(signup.signupId, 'a@dummy.test', false);

    const result = await cancelMySignup(signup.signupId, 'a@dummy.test', false);
    expect(result.promoted).toEqual([]);
  });

  it('auto-promotes the next waitlisted signup and emails them, well before the cutoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z')); // game at 22:00 UTC — 10h out
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00', capacity: 1 }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    store.players.set('b@dummy.test', makePlayer({ email: 'b@dummy.test' }));

    const a = await signUpForSession('2026-07-10', 'a@dummy.test', true);
    const b = await signUpForSession('2026-07-10', 'b@dummy.test', true);
    expect(b.status).toBe('waitlisted');

    const result = await cancelMySignup(a.signupId, 'a@dummy.test', false);
    expect(result.promoted.map((s) => s.signupId)).toEqual([b.signupId]);
    expect(store.signups.get(b.signupId)?.status).toBe('confirmed');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith('b@dummy.test', expect.any(String), expect.any(String));
  });

  it('sends a promotion email to EVERY member of a promoted pair, not just one (regression test)', async () => {
    // This is the exact bug found and fixed on 2026-09-04: promoted pairs
    // used to only email winner.signupIds[0].
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00', capacity: 1 }));
    store.players.set('solo@dummy.test', makePlayer({ email: 'solo@dummy.test' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member One' }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest One' }));

    const solo = await signUpForSession('2026-07-10', 'solo@dummy.test', true); // confirmed, fills capacity 1
    const guest = await signUpAsGuestForSession('2026-07-10', 'guest@dummy.test', 'Member One', true, true); // waitlisted, unpaired
    const member = await signUpForSession('2026-07-10', 'member@dummy.test', true); // waitlisted, pairs with guest
    expect(guest.status).toBe('waitlisted');
    expect(member.status).toBe('waitlisted');

    await cancelMySignup(solo.signupId, 'solo@dummy.test', false);

    expect(store.signups.get(guest.signupId)?.status).toBe('confirmed');
    expect(store.signups.get(member.signupId)?.status).toBe('confirmed');
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith('guest@dummy.test', expect.any(String), expect.any(String));
    expect(sendEmail).toHaveBeenCalledWith('member@dummy.test', expect.any(String), expect.any(String));
  });

  it('does not auto-promote within the 2-hour cutoff, and alerts the organizer instead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T21:00:00.000Z')); // 1h before game (22:00 UTC) — within cutoff
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00', capacity: 1 }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test' }));
    store.players.set('b@dummy.test', makePlayer({ email: 'b@dummy.test' }));

    const a = await signUpForSession('2026-07-10', 'a@dummy.test', true);
    const b = await signUpForSession('2026-07-10', 'b@dummy.test', true);

    const result = await cancelMySignup(a.signupId, 'a@dummy.test', false);
    expect(result.promoted).toEqual([]);
    expect(store.signups.get(b.signupId)?.status).toBe('waitlisted'); // not promoted
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('does not free the slot when only one partner of a confirmed pair cancels', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00', capacity: 1 }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member One' }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest One' }));
    store.players.set('c@dummy.test', makePlayer({ email: 'c@dummy.test' }));

    const member = await signUpForSession('2026-07-10', 'member@dummy.test', true); // confirmed, fills capacity 1
    const guest = await signUpAsGuestForSession('2026-07-10', 'guest@dummy.test', 'Member One', true, true); // pairs with member, confirmed
    expect(guest.status).toBe('confirmed');
    const c = await signUpForSession('2026-07-10', 'c@dummy.test', true); // waitlisted
    expect(c.status).toBe('waitlisted');

    // Member cancels, but guest is still confirmed sharing the same pairId — slot stays occupied.
    const result = await cancelMySignup(member.signupId, 'member@dummy.test', false);
    expect(result.promoted).toEqual([]);
    expect(store.signups.get(c.signupId)?.status).toBe('waitlisted');
  });
});

