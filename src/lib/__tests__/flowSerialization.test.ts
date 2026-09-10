import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fakeSessionsModule,
  fakeSignupsModule,
  fakePlayersModule,
  resetFakeStore,
  makeSession,
  makeSignup,
  makePlayer,
  duringRegistration,
} from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

/**
 * Every mutating flow serializes itself.
 *
 * This is the invariant that used to be each caller's job to remember, and
 * callers kept forgetting: the admin signup override took no lock at all, a
 * session's capacity was written between two acquisitions, and `postTeams`
 * sat unlocked beside three locked siblings. Fixing those one at a time left
 * the next author with the same thing to remember, so the acquisition lives
 * inside the flows and the routes know nothing about it (ADR-0001).
 *
 * The technique: replace the lock with a stub that deliberately does **not**
 * invoke its callback. A flow that guards itself then performs no writes at
 * all, so asserting the repository received nothing proves every write is
 * inside the lock. A write that escapes still fires and fails.
 *
 * **The part that matters more than the assertion.** That technique is
 * worthless against a flow that was never going to write anyway — a fixture
 * too thin to get past a guard clause passes for the wrong reason, silently,
 * forever. An earlier version of this file was backed by bare `vi.fn()` stubs
 * and fourteen of its eighteen cases were vacuous: the flows bailed on a 404
 * or a "registration is not open" long before reaching a write.
 *
 * So there are two suites here and the first one is load-bearing. It runs
 * every flow with the lock working and fails if the flow does not reach a
 * write, which is the only thing that makes the second suite mean anything.
 * The store is `fakeSheets` rather than stubs, seeded with a real week, so
 * the flows actually run.
 */

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));
vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../ntfy', () => ({ sendPush: vi.fn() }));
vi.mock('../gmail', () => ({ sendEmail: vi.fn() }));

const lockRuns = { enabled: true };
const withMutationLock = vi.fn(async (fn: () => unknown) => (lockRuns.enabled ? fn() : undefined));
vi.mock('../lock', () => ({ withMutationLock }));

const sessions = await import('../../sheets/sessions');
const signups = await import('../../sheets/signups');
const players = await import('../../sheets/players');
const signupFlow = await import('../signupFlow');
const subRequestFlow = await import('../subRequestFlow');
const adminFlow = await import('../adminFlow');
const teamFlow = await import('../teamFlow');
const scheduling = await import('../scheduling');

// A real Friday. `makeSession()` defaults to a Thursday, which the weekly
// lookup can never find — game day is Friday, Saturday or Sunday — so the
// cron flows below would silently do nothing against it.
const SESSION = '2099-01-02';
const NEXT_WEEK = '2099-07-10'; // another Friday, with no session yet

/** Every repository call that changes something. */
const WRITES = [
  signups.createSignup,
  signups.updateSignup,
  signups.updateSignupStatus,
  signups.batchUpdateSignups,
  signups.deleteSignup,
  sessions.createSession,
  sessions.updateSession,
  sessions.updateSessionStatus,
  players.upsertPlayer,
] as unknown as { mock: { calls: unknown[] } }[];

const writesMade = () => WRITES.reduce((n, fn) => n + fn.mock.calls.length, 0);

/**
 * A real week: an open session inside its registration window, a member with a
 * profile, a full confirmed roster, someone waiting, and a pending sub request
 * — enough for every flow below to get past its guard clauses and actually do
 * its job.
 */
function seedAWeek() {
  store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, capacity: 5, teamsStatus: 'draft' }));
  store.players.set('member@dummy.test', makePlayer({ email: 'member@dummy.test', fullName: 'Member Mary' }));
  store.players.set('newcomer@dummy.test', makePlayer({ email: 'newcomer@dummy.test', fullName: 'New Nell' }));

  store.signups.set('confirmed-1', makeSignup({ signupId: 'confirmed-1', sessionId: SESSION, email: 'confirmed@dummy.test', fullName: 'Connie Confirmed', status: 'confirmed', teamName: 'Team 1' }));
  store.signups.set('confirmed-2', makeSignup({ signupId: 'confirmed-2', sessionId: SESSION, email: 'other@dummy.test', fullName: 'Otto Other', status: 'confirmed', teamName: 'Team 1' }));
  store.signups.set('waiting-1', makeSignup({ signupId: 'waiting-1', sessionId: SESSION, email: 'waiting@dummy.test', fullName: 'Wanda Waiting', status: 'waitlisted', timestamp: '2099-01-01T00:00:00.000Z' }));
  // A waitlisted player with a request pending against a confirmed one.
  store.signups.set('asker-1', makeSignup({ signupId: 'asker-1', sessionId: SESSION, email: 'asker@dummy.test', fullName: 'Asker Ann', status: 'waitlisted', subRequestTargetEmail: 'confirmed@dummy.test', subRequestStatus: 'pending', subRequestedAt: '2099-01-01T00:00:00.000Z', timestamp: '2099-01-02T00:00:00.000Z' }));
}

/** Each flow, with arguments that reach a write against the seeded week. */
const flows: [name: string, run: () => Promise<unknown>][] = [
  ['signUpForSession', () => signupFlow.signUpForSession(SESSION, 'member@dummy.test', true)],
  ['signUpAsGuestForSession', () => signupFlow.signUpAsGuestForSession(SESSION, 'newcomer@dummy.test', 'Member Mary', true, true)],
  ['cancelMySignup', () => signupFlow.cancelMySignup('confirmed-1', 'confirmed@dummy.test', false)],
  ['fillOpenSpots', () => signupFlow.fillOpenSpots(SESSION)],
  ['requestSub', () => subRequestFlow.requestSub('waiting-1', 'waiting@dummy.test', 'other@dummy.test')],
  ['cancelSubRequest', () => subRequestFlow.cancelSubRequest('asker-1', 'asker@dummy.test')],
  ['respondToSubRequest', () => subRequestFlow.respondToSubRequest('asker-1', 'confirmed@dummy.test', true)],
  ['adminAddSignup', () => adminFlow.adminAddSignup({ sessionId: SESSION, email: 'newcomer@dummy.test', waiverAccepted: true })],
  ['adminCreateSession', () => adminFlow.adminCreateSession({ gameDate: NEXT_WEEK })],
  ['adminRescheduleSession', () => adminFlow.adminRescheduleSession(SESSION, NEXT_WEEK, '18:00')],
  ['reviseSession', () => adminFlow.reviseSession(SESSION, store.sessions.get(SESSION)!, { updates: { capacity: 40 } })],
  ['overrideSignup', () => adminFlow.overrideSignup('waiting-1', { status: 'confirmed' })],
  ['removeSignup', () => adminFlow.removeSignup('waiting-1')],
  ['generateTeams', () => teamFlow.generateTeams(SESSION)],
  ['saveTeams', () => teamFlow.saveTeams(SESSION, [{ signupId: 'confirmed-1', teamName: 'Team 2' }])],
  ['postTeams', () => teamFlow.postTeams(SESSION)],
  // The crons are gated on the clock, so they run at the instant they fire
  // rather than at the shared "during registration" time.
  // Monday 9am ET of a week with no session yet: the cron creates it.
  ['openRegistrationForUpcomingSession', () => scheduling.openRegistrationForUpcomingSession(new Date('2099-07-06T13:00:00.000Z'))],
  // After this week's Tuesday-midnight close, with the session still open.
  ['closeRegistrationForCurrentSession', () => scheduling.closeRegistrationForCurrentSession(new Date('2099-01-02T17:00:00.000Z'))],
];

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
  lockRuns.enabled = true;
  // Signups are gated on the registration window, so run at a fixed instant
  // inside it rather than at whatever time the suite happens to run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(duringRegistration(SESSION));
  seedAWeek();
});
afterEach(() => vi.useRealTimers());

/**
 * The guard that makes the suite below mean something. Without it a fixture
 * that stops a flow early looks exactly like a lock that stopped it.
 */
describe('each flow actually reaches a write when the lock runs', () => {
  it.each(flows)('%s writes something', async (name, run) => {
    await run().catch((err) => {
      throw new Error(`${name} threw before writing: ${err instanceof Error ? err.message : String(err)}`);
    });

    expect(
      writesMade(),
      `${name} performed no writes, so the serialization assertion for it would pass vacuously. ` +
        `Give it a fixture that reaches its write.`
    ).toBeGreaterThan(0);
  });
});

describe('every mutating flow performs its writes inside the mutation lock', () => {
  it.each(flows)('%s writes nothing when the lock does not run its callback', async (_name, run) => {
    lockRuns.enabled = false;

    await run().catch(() => {
      // Irrelevant: the probe leaves the flow in a state production never has,
      // because the real lock either runs the work or throws 503.
    });

    expect(writesMade()).toBe(0);
  });
});

describe('the busy error still reaches the caller', () => {
  it('propagates when the lock cannot be acquired', async () => {
    const { ApiError } = await import('../apiErrors');
    withMutationLock.mockRejectedValueOnce(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    await expect(signupFlow.signUpForSession(SESSION, 'member@dummy.test', true)).rejects.toThrow(/busy/);
    expect(writesMade()).toBe(0);
  });
});
