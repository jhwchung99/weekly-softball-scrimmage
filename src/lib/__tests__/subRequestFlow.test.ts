import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

// vi.hoisted's callback runs before this file's own imports are linked,
// so the store shape is inlined here rather than calling the imported
// createFakeStore(). vi.mock's factories below run lazily (only once
// the mocked module is actually imported), so they CAN safely reference
// imported helpers like fakeSessionsModule.
const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));

const sendEmail = vi.fn();
vi.mock('../../lib/gmail', () => ({ sendEmail }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { signUpForSession } = await import('../signupFlow');
const { requestSub, cancelSubRequest, respondToSubRequest, clearOwnPendingRequest, clearPendingRequestsTargeting } = await import(
  '../subRequestFlow'
);

const SESSION_ID = '2099-01-01';

async function setUpConfirmedAndWaitlisted() {
  store.sessions.set(SESSION_ID, makeSession({ sessionId: SESSION_ID, capacity: 1 }));
  store.players.set('confirmed@dummy.test', makePlayer({ email: 'confirmed@dummy.test', fullName: 'Confirmed Player' }));
  store.players.set('waitlisted@dummy.test', makePlayer({ email: 'waitlisted@dummy.test', fullName: 'Waitlisted Player' }));
  const confirmed = await signUpForSession(SESSION_ID, 'confirmed@dummy.test', true);
  const waitlisted = await signUpForSession(SESSION_ID, 'waitlisted@dummy.test', true);
  return { confirmed, waitlisted };
}

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
});

describe('requestSub', () => {
  it('sets a pending request and emails the target', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    const updated = await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    expect(updated.subRequestStatus).toBe('pending');
    expect(updated.subRequestTargetEmail).toBe('confirmed@dummy.test');
    expect(sendEmail).toHaveBeenCalledWith('confirmed@dummy.test', expect.any(String), expect.any(String));
  });

  it('rejects a request from a confirmed (non-waitlisted) signup', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    await expect(requestSub(confirmed.signupId, 'confirmed@dummy.test', 'waitlisted@dummy.test')).rejects.toThrow(/waitlisted/);
  });

  it('rejects requesting someone not signed up for the session', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await expect(requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'nobody@dummy.test')).rejects.toThrow(/isn't signed up/);
  });

  it('rejects requesting yourself', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await expect(requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'waitlisted@dummy.test')).rejects.toThrow(/yourself/);
  });

  it('anti-spam: rejects a second request while one is already pending', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    store.players.set('other@dummy.test', makePlayer({ email: 'other@dummy.test' }));
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    await expect(requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test')).rejects.toThrow(
      /already have a pending sub request/
    );
  });

  it('rejects requesting someone already sharing a slot with someone else', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    store.signups.set(confirmed.signupId, { ...confirmed, pairId: 'already-paired' });

    await expect(requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test')).rejects.toThrow(
      /already sharing a slot/
    );
  });

  it('IDOR: rejects requesting on someone else\'s behalf', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await expect(requestSub(waitlisted.signupId, 'someone-else@dummy.test', 'confirmed@dummy.test')).rejects.toThrow(
      /your own signup/
    );
  });
});

describe('cancelSubRequest', () => {
  it('clears a pending request back to empty', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    const cancelled = await cancelSubRequest(waitlisted.signupId, 'waitlisted@dummy.test');
    expect(cancelled.subRequestStatus).toBe('');
    expect(cancelled.subRequestTargetEmail).toBe('');
  });

  it('rejects cancelling when there is no pending request', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await expect(cancelSubRequest(waitlisted.signupId, 'waitlisted@dummy.test')).rejects.toThrow(/No pending sub request/);
  });

  it('lets a resolved (declined) request be replaced by a new one', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');
    await respondToSubRequest(waitlisted.signupId, 'confirmed@dummy.test', false); // decline

    store.players.set('other@dummy.test', makePlayer({ email: 'other@dummy.test' }));
    await signUpForSession(SESSION_ID, 'other@dummy.test', true); // becomes waitlisted (capacity already full)
    const updated = await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'other@dummy.test');
    expect(updated.subRequestStatus).toBe('pending');
  });
});

describe('respondToSubRequest', () => {
  it('accept: pairs both signups, mirrors the target status, and clears the request', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    const accepted = await respondToSubRequest(waitlisted.signupId, 'confirmed@dummy.test', true);
    expect(accepted.status).toBe('confirmed');
    expect(accepted.pairId).toBeTruthy();
    expect(accepted.subRequestStatus).toBe('');
    expect(store.signups.get(confirmed.signupId)?.pairId).toBe(accepted.pairId);
    expect(sendEmail).toHaveBeenCalledWith('waitlisted@dummy.test', expect.any(String), expect.any(String));
    expect(sendEmail).toHaveBeenCalledWith('confirmed@dummy.test', expect.any(String), expect.any(String));
  });

  it('decline: leaves the requester waitlisted with a declined status', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    const declined = await respondToSubRequest(waitlisted.signupId, 'confirmed@dummy.test', false);
    expect(declined.status).toBe('waitlisted');
    expect(declined.subRequestStatus).toBe('declined');
  });

  it('rejects a response from someone the request wasn\'t addressed to', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    await expect(respondToSubRequest(waitlisted.signupId, 'random@dummy.test', true)).rejects.toThrow(/not addressed to you/);
  });

  it('accepting one request auto-declines every other pending request to the same target', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    store.players.set('other@dummy.test', makePlayer({ email: 'other@dummy.test' }));
    const other = await signUpForSession(SESSION_ID, 'other@dummy.test', true); // waitlisted

    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');
    await requestSub(other.signupId, 'other@dummy.test', 'confirmed@dummy.test');

    await respondToSubRequest(waitlisted.signupId, 'confirmed@dummy.test', true);
    const otherAfter = store.signups.get(other.signupId);
    expect(otherAfter?.subRequestStatus).toBe('declined');
    expect(otherAfter?.status).toBe('waitlisted'); // not paired
  });

  it('rejects accepting when the target already paired with someone else in the meantime', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');
    store.signups.set(confirmed.signupId, { ...store.signups.get(confirmed.signupId)!, pairId: 'someone-else-pair' });

    await expect(respondToSubRequest(waitlisted.signupId, 'confirmed@dummy.test', true)).rejects.toThrow(/already sharing a slot/);
  });
});

describe('cleanup hooks', () => {
  it('clearOwnPendingRequest clears a pending request and leaves a non-pending one alone', async () => {
    const { waitlisted } = await setUpConfirmedAndWaitlisted();
    const requested = await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');

    await clearOwnPendingRequest(requested);
    expect(store.signups.get(waitlisted.signupId)?.subRequestStatus).toBe('');

    // No-op when there's nothing pending (shouldn't throw or touch anything).
    const cleared = store.signups.get(waitlisted.signupId)!;
    await clearOwnPendingRequest(cleared);
    expect(store.signups.get(waitlisted.signupId)?.subRequestStatus).toBe('');
  });

  it('clearPendingRequestsTargeting clears every request aimed at a given email, excluding one signup', async () => {
    const { confirmed, waitlisted } = await setUpConfirmedAndWaitlisted();
    store.players.set('other@dummy.test', makePlayer({ email: 'other@dummy.test' }));
    const other = await signUpForSession(SESSION_ID, 'other@dummy.test', true);
    await requestSub(waitlisted.signupId, 'waitlisted@dummy.test', 'confirmed@dummy.test');
    await requestSub(other.signupId, 'other@dummy.test', 'confirmed@dummy.test');

    const allSignups = [...store.signups.values()];
    await clearPendingRequestsTargeting('confirmed@dummy.test', allSignups, other.signupId);

    expect(store.signups.get(waitlisted.signupId)?.subRequestStatus).toBe(''); // cleared
    expect(store.signups.get(other.signupId)?.subRequestStatus).toBe('pending'); // excluded, untouched
  });
});
