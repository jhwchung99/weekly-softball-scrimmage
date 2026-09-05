import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { normalizeEmail } = await import('../email');
const { signUpForSession, cancelMySignup, getMyStatusForSession } = await import('../signupFlow');
const { requestSub, cancelSubRequest } = await import('../subRequestFlow');

beforeEach(() => resetFakeStore(store));

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Josh@Gmail.COM ')).toBe('josh@gmail.com');
  });

  it('is idempotent', () => {
    expect(normalizeEmail(normalizeEmail('A@B.com'))).toBe('a@b.com');
  });
});

/**
 * Regression coverage for Bug 1 in planner/2026-09-05-code-security-review.md:
 * ownership checks compared emails case-sensitively while lookups normalized,
 * so a row stored with different casing (e.g. an organizer hand-typing it into
 * the admin add-signup form) left the player able to SEE their signup but not
 * cancel it.
 */
describe('email casing does not break ownership checks', () => {
  const SESSION = '2099-01-01';

  async function signupStoredWithMixedCase() {
    store.sessions.set(SESSION, makeSession({ capacity: 5 }));
    store.players.set('josh@gmail.com', makePlayer({ email: 'Josh@Gmail.com', fullName: 'Josh' }));
    // Signing up with the mixed-case form still stores a normalized row...
    const signup = await signUpForSession(SESSION, 'Josh@Gmail.com', true);
    return signup;
  }

  it('normalizes the email on write, whatever casing it arrived in', async () => {
    const signup = await signupStoredWithMixedCase();
    expect(store.signups.get(signup.signupId)?.email).toBe('josh@gmail.com');
  });

  it('lets the owner cancel regardless of the casing on either side', async () => {
    const signup = await signupStoredWithMixedCase();
    // Force a legacy mixed-case row, as migrated-from data would look.
    store.signups.set(signup.signupId, { ...store.signups.get(signup.signupId)!, email: 'Josh@Gmail.com' });

    const status = await getMyStatusForSession(SESSION, 'josh@gmail.com');
    expect(status.signup?.signupId).toBe(signup.signupId); // visible...

    await expect(cancelMySignup(signup.signupId, 'josh@gmail.com', false)).resolves.toBeDefined(); // ...and cancellable
    expect(store.signups.get(signup.signupId)?.status).toBe('cancelled');
  });

  it('still rejects a genuinely different person', async () => {
    const signup = await signupStoredWithMixedCase();
    await expect(cancelMySignup(signup.signupId, 'someone.else@dummy.test', false)).rejects.toThrow(/only cancel your own/);
  });

  it('matches an existing profile stored with different casing (no duplicate row)', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 5 }));
    store.players.set('mixed@dummy.test', makePlayer({ email: 'MiXeD@Dummy.Test' }));
    // Would have thrown PROFILE_REQUIRED before, forcing a second Players row.
    await expect(signUpForSession(SESSION, 'mixed@dummy.test', true)).resolves.toBeDefined();
  });

  it('blocks a duplicate signup that differs only by casing', async () => {
    await signupStoredWithMixedCase();
    await expect(signUpForSession(SESSION, 'JOSH@GMAIL.COM', true)).rejects.toThrow(/already signed up/);
  });

  it('lets the owner manage a sub request regardless of casing', async () => {
    store.sessions.set(SESSION, makeSession({ capacity: 1 }));
    store.players.set('a@dummy.test', makePlayer({ email: 'a@dummy.test', fullName: 'A' }));
    store.players.set('b@dummy.test', makePlayer({ email: 'b@dummy.test', fullName: 'B' }));
    await signUpForSession(SESSION, 'a@dummy.test', true); // confirmed
    const b = await signUpForSession(SESSION, 'b@dummy.test', true); // waitlisted

    await requestSub(b.signupId, 'B@Dummy.Test', 'A@Dummy.Test');
    expect(store.signups.get(b.signupId)?.subRequestStatus).toBe('pending');

    await expect(cancelSubRequest(b.signupId, 'B@DUMMY.TEST')).resolves.toBeDefined();
  });
});
