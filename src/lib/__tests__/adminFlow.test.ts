import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { adminAddSignup } = await import('../adminFlow');

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
