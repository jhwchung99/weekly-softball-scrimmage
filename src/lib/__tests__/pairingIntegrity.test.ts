import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * An integration test by choice now, rather than by necessity.
 *
 * The architecture review flagged that this drives two flow modules through
 * five mocks to assert one invariant, and that it was shaped that way because
 * "a pair is one spot" had no interface to be tested through. It has one now
 * (lib/pair.ts, and lib/waitlist.ts for promotion order), and both are covered
 * directly by their own tests.
 *
 * This stays because what it checks is different: that the invariant survives
 * the real signup and sub-request paths end to end, including the writes. The
 * mocks are the cost of running those paths, not a symptom of a missing
 * interface — so thinning it out would trade real coverage for tidiness.
 */
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer , duringRegistration} from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { signUpForSession, signUpAsGuestForSession, getMyStatusForSession } = await import('../signupFlow');
const { countConfirmedSpots } = await import('../payments');
const { requestSub, respondToSubRequest } = await import('../subRequestFlow');
const { updateSignup } = await import('../../sheets/signups');

const SESSION = '2099-01-01';

beforeEach(() => {
  resetFakeStore(store);
  // Player signups are gated on the registration window now, so these
  // run at a fixed instant inside it rather than at whatever time the
  // suite happens to be run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(duringRegistration());
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A pair split across statuses, left behind by the two asymmetric auto-merge
 * paths, was a real bug once. Those paths
 * are gone: since the 2026-09-07 consent change a pair is only ever created
 * by respondToSubRequest, which writes one status to both rows at once, so a
 * split pair can no longer be constructed at signup time at all.
 */
describe('pairing requires the member to accept', () => {
  it('offers rather than merges, and the guest waits on the answer', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 1 }));
    store.players.set('taken@dummy.test', makePlayer({ email: 'taken@dummy.test', fullName: 'Taken T' }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest G' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member M' }));

    await signUpForSession(SESSION, 'taken@dummy.test', true); // takes the only spot
    const g = await signUpAsGuestForSession(SESSION, 'guest@dummy.test', 'Member M', true, true);
    const m = await signUpForSession(SESSION, 'member@dummy.test', true);

    // A request, not a pair.
    expect(store.signups.get(g.signupId)?.subRequestStatus).toBe('pending');
    expect(store.signups.get(g.signupId)?.pairId).toBe('');
    expect(store.signups.get(m.signupId)?.pairId).toBe('');
  });

  it('puts both on one status once the member accepts', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 1, pricePerSpot: 20 }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest G' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member M' }));

    const m = await signUpForSession(SESSION, 'member@dummy.test', true); // confirmed, fills capacity 1
    const g = await signUpAsGuestForSession(SESSION, 'guest@dummy.test', 'Member M', true, true); // waitlisted + request
    expect(store.signups.get(g.signupId)?.subRequestStatus).toBe('pending');

    await respondToSubRequest(g.signupId, 'member@dummy.test', true);

    const memberRow = store.signups.get(m.signupId)!;
    const guestRow = store.signups.get(g.signupId)!;
    expect(guestRow.pairId).toBeTruthy();
    expect(guestRow.pairId).toBe(memberRow.pairId);
    expect(guestRow.status).toBe('confirmed');
    expect(memberRow.status).toBe('confirmed');
    expect(countConfirmedSpots([...store.signups.values()])).toBe(1); // still one spot

    // And both are billed for their half rather than either being skipped.
    const status = await getMyStatusForSession(SESSION, 'member@dummy.test');
    expect(status.costOwed).toBe(10);
  });

  it('declining leaves the guest on the waitlist with their own place in line', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 1 }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest G' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member M' }));

    await signUpForSession(SESSION, 'member@dummy.test', true);
    const g = await signUpAsGuestForSession(SESSION, 'guest@dummy.test', 'Member M', true, true);

    await respondToSubRequest(g.signupId, 'member@dummy.test', false);

    const guestRow = store.signups.get(g.signupId)!;
    expect(guestRow.subRequestStatus).toBe('declined');
    expect(guestRow.pairId).toBe('');
    expect(guestRow.status).toBe('waitlisted');
  });

  it('never offers a pairing to a guest who already has their own confirmed spot', async () => {
    // Folding a confirmed guest into someone else's spot would drop the
    // roster under capacity with nothing to refill it.
    store.sessions.set(SESSION, makeSession({ capacity: 5 }));
    store.players.set('guest@dummy.test', makePlayer({ email: 'guest@dummy.test', fullName: 'Guest G' }));
    store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member M' }));

    const g = await signUpAsGuestForSession(SESSION, 'guest@dummy.test', 'Member M', true, true);
    const m = await signUpForSession(SESSION, 'member@dummy.test', true);

    expect(store.signups.get(g.signupId)?.status).toBe('confirmed');
    expect(store.signups.get(g.signupId)?.subRequestStatus).toBe('');
    expect(store.signups.get(m.signupId)?.pairId).toBe('');
  });
});

/**
 * Regression coverage for Bug 2. An admin status override used to leave a
 * pending sub request live; accepting it then folded an already-confirmed
 * player into someone else's spot, dropping the roster below capacity with no
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
    expect(countConfirmedSpots([...store.signups.values()])).toBe(3);

    await expect(respondToSubRequest(c.signupId, 'a@dummy.test', true)).rejects.toThrow(/already has their own spot/);

    // Roster untouched, and D is still a normal waitlist candidate.
    expect(countConfirmedSpots([...store.signups.values()])).toBe(3);
    expect(store.signups.get(d.signupId)?.status).toBe('waitlisted');
  });

  it('still allows a normal accept while the requester is genuinely waitlisted', async () => {
    const { c } = await stageStaleRequest();

    const updated = await respondToSubRequest(c.signupId, 'a@dummy.test', true);

    expect(updated.pairId).toBeTruthy();
    expect(updated.status).toBe('confirmed'); // shares A's spot
    expect(countConfirmedSpots([...store.signups.values()])).toBe(2); // capacity preserved
  });
});
