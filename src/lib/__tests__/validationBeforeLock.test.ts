import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

/**
 * A request that is going to be rejected must be rejected before it queues.
 *
 * There is one write lock for the whole app. Validating inside it means a
 * typo'd date waits behind every other write for up to ACQUIRE_TIMEOUT_MS,
 * comes back 503 instead of saying what was wrong, and holds the lock while
 * it fails. The player-facing routes were moved out of the lock for exactly
 * this; three organizer flows kept validating inside it.
 *
 * The lock is replaced with a recorder rather than checked for timing,
 * because "did this take the lock at all" is the actual question.
 */

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));
const entered = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));
vi.mock('../lock', () => ({
  withMutationLock: async <T,>(fn: () => Promise<T>): Promise<T> => {
    entered.count += 1;
    return fn();
  },
  LOCK_TTL_SECONDS: 120,
  ACQUIRE_TIMEOUT_MS: 10_000,
}));

const { adminAddSignup, adminCreateSession, adminRescheduleSession } = await import('../adminFlow');

beforeEach(() => {
  resetFakeStore(store);
  entered.count = 0;
});

const rejectedWithoutLocking = async (run: () => Promise<unknown>) => {
  await expect(run()).rejects.toThrow();
  return entered.count;
};

describe('organizer flows validate before taking the write lock', () => {
  it('adminCreateSession — a bad game date never queues', async () => {
    expect(await rejectedWithoutLocking(() => adminCreateSession({ gameDate: 'not-a-date' }))).toBe(0);
  });

  it('adminRescheduleSession — a bad new date never queues', async () => {
    expect(await rejectedWithoutLocking(() => adminRescheduleSession('2026-07-10', 'nonsense', '18:00'))).toBe(0);
  });

  it('adminAddSignup — an unusable profile never queues', async () => {
    expect(
      await rejectedWithoutLocking(() =>
        adminAddSignup({
          sessionId: '2026-07-10',
          email: 'someone@dummy.test',
          profile: { fullName: '', gender: '', savedPositions: '' },
          waiverAccepted: true,
        })
      )
    ).toBe(0);
  });

  it('adminAddSignup — a blank invited-by name never queues', async () => {
    expect(
      await rejectedWithoutLocking(() =>
        adminAddSignup({
          sessionId: '2026-07-10',
          email: 'guest@dummy.test',
          invitedByName: '   ',
          waiverAccepted: true,
        })
      )
    ).toBe(0);
  });

  it('but a valid request does still take the lock', async () => {
    // Otherwise the assertions above would pass just as well against a flow
    // that had stopped locking altogether.
    await adminCreateSession({ gameDate: '2026-07-10' });

    expect(entered.count).toBeGreaterThan(0);
  });
});
