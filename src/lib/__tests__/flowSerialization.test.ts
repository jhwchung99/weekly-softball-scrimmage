import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every mutating flow serializes itself.
 *
 * This is the invariant that used to be each caller's job to remember, and
 * two callers forgot — the admin signup override took no lock at all, and a
 * session's capacity was written between two separate acquisitions. Fixing
 * those one at a time left the next author with the same thing to remember,
 * so the acquisition now lives inside the flows and the routes know nothing
 * about it.
 *
 * The technique is the one the tier 1 route tests used, moved down to the
 * seam the lock moved to: replace the lock with a stub that deliberately does
 * **not** invoke its callback. A flow that guards itself then performs no
 * writes at all, so asserting the repository received nothing proves every
 * write is inside the lock. A write that escapes still fires and fails here.
 *
 * It asserts what reaches the repository rather than that `withMutationLock`
 * was called, so it says something about behaviour rather than about wiring.
 */

const lockRuns = { enabled: true };
const withMutationLock = vi.fn(async (fn: () => unknown) => (lockRuns.enabled ? fn() : undefined));
vi.mock('../lock', () => ({ withMutationLock }));

/** Every repository write in the app. If a flow reaches one of these while the
 * lock is refusing to run, that write was never inside the lock. */
const writes = {
  createSignup: vi.fn(),
  updateSignup: vi.fn(),
  updateSignupStatus: vi.fn(),
  batchUpdateSignups: vi.fn(),
  deleteSignup: vi.fn(),
};
const reads = {
  listSignupsForSession: vi.fn(async () => []),
  getSignup: vi.fn(async () => null),
  getSignupWithSessionSignups: vi.fn(async () => ({ signup: null, sessionSignups: [] })),
  getSignupsByIds: vi.fn(async () => []),
  findActiveSignup: vi.fn(async () => null),
  findMemberSignupByName: vi.fn(async () => null),
  findPendingGuestInvite: vi.fn(async () => null),
  generateSignupId: vi.fn(() => 'generated'),
};
vi.mock('../../sheets/signups', () => ({ ...reads, ...writes }));

const sessionWrites = {
  createSession: vi.fn(),
  updateSession: vi.fn(),
  updateSessionStatus: vi.fn(),
};
const getSession = vi.fn(async (): Promise<Record<string, unknown> | null> => ({
  sessionId: '2099-01-01',
  gameDate: '2099-01-01',
  gameTime: '18:00',
  capacity: 10,
  status: 'open',
  numFields: 1,
  teamsStatus: '',
  cost: 0,
  pricePerSpot: 10,
}));
vi.mock('../../sheets/sessions', () => ({
  getSession,
  getSessionByAnyId: vi.fn(async () => null),
  listSessions: vi.fn(async () => []),
  ...sessionWrites,
}));

const upsertPlayer = vi.fn();
vi.mock('../../sheets/players', () => ({
  upsertPlayer,
  getPlayer: vi.fn(async () => ({ email: 'a@dummy.test', fullName: 'A', gender: 'Other', savedPositions: '' })),
}));

vi.mock('../ntfy', () => ({ sendPush: vi.fn() }));
vi.mock('../gmail', () => ({ sendEmail: vi.fn() }));

const signupFlow = await import('../signupFlow');
const subRequestFlow = await import('../subRequestFlow');
const adminFlow = await import('../adminFlow');
const teamFlow = await import('../teamFlow');

/** Every repository write across both tabs, plus the player tab. */
const allWrites = { ...writes, ...sessionWrites, upsertPlayer };

function assertNothingWasWritten() {
  for (const [name, spy] of Object.entries(allWrites)) {
    expect(spy, `${name} was called outside the lock`).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  lockRuns.enabled = true;
});

/**
 * Each case runs its flow with the lock refusing to run its callback. What the
 * flow returns or throws in that state is not meaningful — the lock either
 * runs the work or throws 503, so this state is unreachable in production. The
 * assertion is only ever "nothing was written".
 */
const flows: [name: string, run: () => Promise<unknown>][] = [
  ['signUpForSession', () => signupFlow.signUpForSession('2099-01-01', 'a@dummy.test', true)],
  ['signUpAsGuestForSession', () => signupFlow.signUpAsGuestForSession('2099-01-01', 'a@dummy.test', 'Member', true, true)],
  ['cancelMySignup', () => signupFlow.cancelMySignup('sid', 'a@dummy.test', false)],
  ['fillOpenSpots', () => signupFlow.fillOpenSpots('2099-01-01')],
  ['requestSub', () => subRequestFlow.requestSub('sid', 'a@dummy.test', 'b@dummy.test')],
  ['cancelSubRequest', () => subRequestFlow.cancelSubRequest('sid', 'a@dummy.test')],
  ['respondToSubRequest', () => subRequestFlow.respondToSubRequest('sid', 'a@dummy.test', true)],
  ['adminAddSignup', () => adminFlow.adminAddSignup({ sessionId: '2099-01-01', email: 'a@dummy.test', waiverAccepted: true })],
  ['adminCreateSession', () => adminFlow.adminCreateSession({ gameDate: '2099-06-06' })],
  ['adminRescheduleSession', () => adminFlow.adminRescheduleSession('2099-01-01', '2099-06-06', '18:00')],
  ['generateTeams', () => teamFlow.generateTeams('2099-01-01')],
  ['saveTeams', () => teamFlow.saveTeams('2099-01-01', [{ signupId: 'sid', teamName: 'Team 1' }])],
];

describe('every mutating flow performs its writes inside the mutation lock', () => {
  it.each(flows)('%s writes nothing when the lock does not run its callback', async (_name, run) => {
    lockRuns.enabled = false;

    await run().catch(() => {
      // Irrelevant: the probe leaves the flow in a state production never has.
    });

    assertNothingWasWritten();
  });
});

describe('the flows still work normally when the lock runs', () => {
  // These matter: without them, a flow that silently did nothing would pass
  // every assertion above for the wrong reason.
  it('signs someone up', async () => {
    // Bypasses the registration window, which a session dated 2099 is not in.
    await signupFlow.signUpForSession('2099-01-01', 'a@dummy.test', true, { bypassRegistrationWindow: true });

    expect(writes.createSignup).toHaveBeenCalled();
  });

  it('creates a session', async () => {
    getSession.mockResolvedValueOnce(null); // no clash on that date

    await adminFlow.adminCreateSession({ gameDate: '2099-06-06' });

    expect(sessionWrites.createSession).toHaveBeenCalled();
  });

  it('propagates the busy error when the lock cannot be acquired', async () => {
    const { ApiError } = await import('../apiErrors');
    withMutationLock.mockRejectedValueOnce(
      new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.')
    );

    await expect(
      signupFlow.signUpForSession('2099-01-01', 'a@dummy.test', true, { bypassRegistrationWindow: true })
    ).rejects.toThrow(/busy/);
    expect(writes.createSignup).not.toHaveBeenCalled();
  });
});
