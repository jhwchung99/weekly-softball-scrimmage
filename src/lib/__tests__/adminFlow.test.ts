import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { adminAddSignup, adminCreateSession, adminRescheduleSession } = await import('../adminFlow');
const { signUpForSession } = await import('../signupFlow');

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
});

describe('adminAddSignup', () => {
  it('upserts a profile first, then signs the person up, for a first-time player', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));

    const signup = await adminAddSignup({
      sessionId: '2099-01-01',
      email: 'new@dummy.test',
      profile: { fullName: 'New Player', gender: 'Other', age: 25, savedPositions: 'Catcher' },
      waiverAccepted: true,
    });

    expect(signup.status).toBe('confirmed');
    expect(store.players.get('new@dummy.test')?.fullName).toBe('New Player');
  });

  it('skips the profile upsert when the player already has one', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));
    store.players.set('existing@dummy.test', { email: 'existing@dummy.test', fullName: 'Existing', gender: 'Other', age: 40, savedPositions: '' });

    await adminAddSignup({ sessionId: '2099-01-01', email: 'existing@dummy.test', waiverAccepted: true });
    expect(store.players.get('existing@dummy.test')?.fullName).toBe('Existing');
  });

  it('routes through the guest path when invitedByName is given', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));
    const signup = await adminAddSignup({
      sessionId: '2099-01-01',
      email: 'guest@dummy.test',
      profile: { fullName: 'Guest', gender: 'Other', age: 22, savedPositions: '' },
      invitedByName: 'Someone',
      waiverAccepted: true,
    });
    expect(signup.memberStatus).toBe('guest');
    expect(signup.invitedByName).toBe('Someone');
  });

  it('still rejects adding to a closed session — admin doesn\'t bypass that rule', async () => {
    store.sessions.set('2099-01-01', makeSession({ status: 'closed' }));
    await expect(
      adminAddSignup({
        sessionId: '2099-01-01',
        email: 'new@dummy.test',
        profile: { fullName: 'New Player', gender: 'Other', age: 25, savedPositions: '' },
        waiverAccepted: true,
      })
    ).rejects.toThrow(/not currently open/);
  });

  it('requires waiverAccepted even for an admin-added signup', async () => {
    store.sessions.set('2099-01-01', makeSession());
    await expect(
      adminAddSignup({
        sessionId: '2099-01-01',
        email: 'new@dummy.test',
        profile: { fullName: 'New Player', gender: 'Other', age: 25, savedPositions: '' },
        waiverAccepted: false,
      })
    ).rejects.toThrow(/waiver/);
  });
});

// 2026-07-10/11/12 are the Friday/Saturday/Sunday of the same week;
// 2026-07-06 is that week's Monday (see time.test.ts for the same dates).
describe('adminCreateSession', () => {
  it('creates a session with defaults filled in', async () => {
    const session = await adminCreateSession({ gameDate: '2026-07-10' });
    expect(session).toMatchObject({
      sessionId: '2026-07-10',
      gameDate: '2026-07-10',
      gameTime: '18:00',
      capacity: 20,
      cost: 0,
      status: 'open',
    });
    expect(store.sessions.get('2026-07-10')).toBeDefined();
  });

  it('accepts explicit gameTime/capacity/cost overrides, and a Saturday/Sunday date', () => {
    return expect(adminCreateSession({ gameDate: '2026-07-11', gameTime: '10:00', capacity: 12, cost: 50 })).resolves.toMatchObject({
      sessionId: '2026-07-11',
      gameTime: '10:00',
      capacity: 12,
      cost: 50,
    });
  });

  it('rejects a date that is not Friday/Saturday/Sunday', async () => {
    await expect(adminCreateSession({ gameDate: '2026-07-06' })).rejects.toThrow(/Friday, Saturday, or Sunday/);
  });

  it('rejects creating a session that already exists', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10' }));
    await expect(adminCreateSession({ gameDate: '2026-07-10' })).rejects.toThrow(/already exists/);
  });
});

describe('adminRescheduleSession', () => {
  it('updates gameTime in place when the date is unchanged — no rekey', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', gameTime: '18:00' }));

    const session = await adminRescheduleSession('2026-07-10', '2026-07-10', '19:30');

    expect(session.gameTime).toBe('19:30');
    expect(store.sessions.get('2026-07-10')?.gameTime).toBe('19:30');
  });

  it('rekeys the session and cascades sessionId to every signup when the date moves', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 5 }));
    store.players.set('a@dummy.test', { email: 'a@dummy.test', fullName: 'A', gender: 'Other', age: 30, savedPositions: '' });
    const signup = await signUpForSession('2026-07-10', 'a@dummy.test', true);

    const session = await adminRescheduleSession('2026-07-10', '2026-07-11', '20:00');

    expect(session).toMatchObject({ sessionId: '2026-07-11', gameDate: '2026-07-11', gameTime: '20:00' });
    expect(store.sessions.has('2026-07-10')).toBe(false);
    expect(store.signups.get(signup.signupId)?.sessionId).toBe('2026-07-11');
  });

  it('rejects moving to a date that already has a session', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10' }));
    store.sessions.set('2026-07-11', makeSession({ sessionId: '2026-07-11', gameDate: '2026-07-11' }));

    await expect(adminRescheduleSession('2026-07-10', '2026-07-11', '18:00')).rejects.toThrow(/already exists/);
  });

  it('rejects a date that is not Friday/Saturday/Sunday', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10' }));
    await expect(adminRescheduleSession('2026-07-10', '2026-07-06', '18:00')).rejects.toThrow(/Friday, Saturday, or Sunday/);
  });

  it('rejects rescheduling a session that does not exist', async () => {
    await expect(adminRescheduleSession('2026-07-10', '2026-07-11', '18:00')).rejects.toThrow(/No such session/);
  });
});
