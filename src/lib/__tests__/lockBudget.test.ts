import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makeSignup } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';
import { LOCK_TTL_SECONDS, ACQUIRE_TIMEOUT_MS } from '../lock';
import { RATE_LIMIT_RETRY_DELAYS_MS } from '../../sheets/client';

/**
 * The mutation lock's TTL has to exceed the worst-case duration of the work it
 * protects. If it does not, the lock expires mid-flight and a second request
 * starts mutating alongside the first, losing the mutual exclusion the lock
 * exists for. That has happened once already: 15s was too tight in exactly the
 * rate-limited conditions the lock matters most in.
 *
 * ADR-0001 records that revising a session is the longest hold — a rekey, a
 * field write and the promotion cascade under one acquisition — and names it as
 * the first place to look if the ceiling needs raising. This turns that note
 * into something that fails when it stops being true, rather than a warning
 * nobody re-checks.
 *
 * It measures Sheets *calls*, not seconds. Wall-clock time in a test says
 * nothing about production, but the call count is the thing that multiplies:
 * every call can sleep through the full rate-limit backoff, so calls x backoff
 * is the worst case the TTL has to cover.
 */

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));
vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../ntfy', () => ({ sendPush: vi.fn() }));
vi.mock('../gmail', () => ({ sendEmail: vi.fn() }));

const sessions = await import('../../sheets/sessions');
const signups = await import('../../sheets/signups');
const { reviseSession } = await import('../adminFlow');

/** The longest a single Sheets call can take when it is being rate limited:
 * every retry sleeps, then the call itself still has to run. */
const WORST_CASE_PER_CALL_MS = RATE_LIMIT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

/** Every repository call made, across both tabs. */
function callsMade(): number {
  const spies = [...Object.values(sessions), ...Object.values(signups)] as unknown[];
  return spies.reduce<number>(
    (n, fn) => n + ((fn as { mock?: { calls: unknown[] } })?.mock?.calls.length ?? 0),
    0
  );
}

const SESSION = '2026-07-10';

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('the mutation lock TTL covers the longest hold', () => {
  it('is long enough for the worst case of a session revision', async () => {
    // The heaviest shape: move the game (which rekeys the row and rewrites
    // every signup's sessionId) AND raise capacity (which runs the promotion
    // cascade), on a full session with a waitlist to promote from.
    store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, gameTime: '18:00', capacity: 10 }));
    for (let i = 0; i < 10; i++) {
      store.signups.set(`c${i}`, makeSignup({ signupId: `c${i}`, sessionId: SESSION, email: `c${i}@dummy.test`, status: 'confirmed' }));
    }
    for (let i = 0; i < 8; i++) {
      store.signups.set(`w${i}`, makeSignup({ signupId: `w${i}`, sessionId: SESSION, email: `w${i}@dummy.test`, status: 'waitlisted', timestamp: `2026-07-0${i + 1}T00:00:00.000Z` }));
    }

    const existing = store.sessions.get(SESSION)!;
    await reviseSession(SESSION, existing, { gameDate: '2026-07-11', gameTime: '18:00', updates: { capacity: 18 } });

    const worstCaseSeconds = (callsMade() * WORST_CASE_PER_CALL_MS) / 1000;

    expect(
      worstCaseSeconds,
      `A session revision makes ${callsMade()} Sheets calls. At ${WORST_CASE_PER_CALL_MS}ms of rate-limit backoff each ` +
        `that is ${worstCaseSeconds}s of worst-case hold, against a ${LOCK_TTL_SECONDS}s TTL. Either shorten the ` +
        `critical section or raise LOCK_TTL_SECONDS — see ADR-0001.`
    ).toBeLessThanOrEqual(LOCK_TTL_SECONDS);
  });

  it('promotes the whole waitlist when capacity is raised, which is what makes the hold long', async () => {
    // Guards the test above from passing because nothing happened: the call
    // count only means something if the cascade actually ran.
    store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, gameTime: '18:00', capacity: 1 }));
    store.signups.set('c0', makeSignup({ signupId: 'c0', sessionId: SESSION, email: 'c0@dummy.test', status: 'confirmed' }));
    for (let i = 0; i < 3; i++) {
      store.signups.set(`w${i}`, makeSignup({ signupId: `w${i}`, sessionId: SESSION, email: `w${i}@dummy.test`, status: 'waitlisted', timestamp: `2026-07-0${i + 1}T00:00:00.000Z` }));
    }

    const existing = store.sessions.get(SESSION)!;
    const { promoted } = await reviseSession(SESSION, existing, { updates: { capacity: 4 } });

    expect(promoted).toHaveLength(3);
  });

  it('keeps the TTL above the acquisition timeout, so a waiter never outlives the holder', async () => {
    // A caller waits up to ACQUIRE_TIMEOUT_MS. A TTL shorter than that would
    // let the key expire while someone is still queueing for it.
    //
    // Read from the module, not pasted: this said `> 10_000` while the comment
    // named the constant, so raising the timeout would have left the test
    // written to protect that relationship passing anyway.
    expect(LOCK_TTL_SECONDS * 1000).toBeGreaterThan(ACQUIRE_TIMEOUT_MS);
  });
});
