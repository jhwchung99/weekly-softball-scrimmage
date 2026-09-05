import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { signUpForSession, signUpAsGuestForSession, countConfirmedSlots, getMyStatusForSession } = await import('../signupFlow');
const { requestSub, respondToSubRequest } = await import('../subRequestFlow');
const { updateSignup } = await import('../../sheets/signups');

const SESSION = '2099-01-01';

beforeEach(() => resetFakeStore(store));

/**
 * Regression coverage for Bug 3 in planner/2026-09-05-code-security-review.md.
 * The two pairing paths were asymmetric: the guest-side merge synced status,
 * the member-side merge only wrote pairId. A pair split across statuses left
 * the waitlisted half permanently unpromotable (groupWaitlistUnits skips any
 * pairId that already has a confirmed row) and unbilled.
 */
describe('member/guest merge keeps the pair on one status', () => {
  it('promotes the late-arriving member onto the guest\'s confirmed slot', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 1 }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest G' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member M' }));

    // Guest signs up first naming a member who hasn't signed up yet, taking
    // the last individual slot.
    const g = await signUpAsGuestForSession(SESSION, 'guest@dummy.test', 'Member M', true, true);
    expect(store.signups.get(g.signupId)?.status).toBe('confirmed');

    // Member signs up into a now-full session, then merges with their guest.
    const m = await signUpForSession(SESSION, 'member@dummy.test', true);

    const memberRow = store.signups.get(m.signupId)!;
    const guestRow = store.signups.get(g.signupId)!;
    expect(memberRow.pairId).toBeTruthy();
    expect(memberRow.pairId).toBe(guestRow.pairId);
    expect(memberRow.status).toBe('confirmed'); // was 'waitlisted' — the bug
    expect(guestRow.status).toBe('confirmed'); // merging never demotes the slot-holder
    expect(countConfirmedSlots([...store.signups.values()])).toBe(1); // still one slot

    // And the member is billed for their half rather than silently skipped.
    store.sessions.set(SESSION, { ...store.sessions.get(SESSION)!, pricePerSpot: 20 });
    const status = await getMyStatusForSession(SESSION, 'member@dummy.test');
    expect(status.costOwed).toBe(10); // one spot's price, split with the guest
  });

  it('leaves both on the waitlist when the guest was waitlisted too', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 1 }));
    store.players.set('taken@dummy.test', makePlayer({ email: 'taken@dummy.test', fullName: 'Taken T' }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest G' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member M' }));

    await signUpForSession(SESSION, 'taken@dummy.test', true); // takes the only slot
    const g = await signUpAsGuestForSession(SESSION, 'guest@dummy.test', 'Member M', true, true); // waitlisted
    const m = await signUpForSession(SESSION, 'member@dummy.test', true); // waitlisted, then merges

    expect(store.signups.get(g.signupId)?.status).toBe('waitlisted');
    expect(store.signups.get(m.signupId)?.status).toBe('waitlisted');
    expect(store.signups.get(m.signupId)?.pairId).toBe(store.signups.get(g.signupId)?.pairId);
  });
});

/**
 * Regression coverage for Bug 2. An admin status override used to leave a
 * pending sub request live; accepting it then folded an already-confirmed
 * player into someone else's slot, dropping the roster below capacity with no
 * promotion cascade to refill it. Fixed on both sides — the admin route clears
 * the request, and respondToSubRequest re-checks the precondition.
 */
describe('a sub request cannot be accepted once the requester has their own spot', () => {
  async function stageStaleRequest() {
    store.sessions.set(SESSION, makeSession({ capacity: 2 }));
    for (const n of ['a', 'b', 'c', 'd']) {
      store.players.set(`${n}@dummy.test`, makePlayer({ email: `${n}@dummy.test`, fullName: n.toUpperCase() }));
    }
    await signUpForSession(SESSION, 'a@dummy.test', true); // confirmed
    await signUpForSession(SESSION, 'b@dummy.test', true); // confirmed — capacity full
    const c = await signUpForSession(SESSION, 'c@dummy.test', true); // waitlisted
    const d = await signUpForSession(SESSION, 'd@dummy.test', true); // waitlisted

    await requestSub(c.signupId, 'c@dummy.test', 'a@dummy.test');
    return { c, d };
  }

  it('rejects the accept instead of silently shrinking the roster', async () => {
    const { c, d } = await stageStaleRequest();

    // Simulate the admin PATCH route's direct status write.
    await updateSignup(c.signupId, { status: 'confirmed' });
    expect(countConfirmedSlots([...store.signups.values()])).toBe(3);

    await expect(respondToSubRequest(c.signupId, 'a@dummy.test', true)).rejects.toThrow(/already has their own spot/);

    // Roster untouched, and D is still a normal waitlist candidate.
    expect(countConfirmedSlots([...store.signups.values()])).toBe(3);
    expect(store.signups.get(d.signupId)?.status).toBe('waitlisted');
  });

  it('still allows a normal accept while the requester is genuinely waitlisted', async () => {
    const { c } = await stageStaleRequest();

    const updated = await respondToSubRequest(c.signupId, 'a@dummy.test', true);

    expect(updated.pairId).toBeTruthy();
    expect(updated.status).toBe('confirmed'); // shares A's slot
    expect(countConfirmedSlots([...store.signups.values()])).toBe(2); // capacity preserved
  });
});
