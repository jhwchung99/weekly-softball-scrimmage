import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer , duringRegistration} from '../../test/fakeSheets';
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
  // Player signups are gated on the registration window now, so these
  // run at a fixed instant inside it rather than at whatever time the
  // suite happens to be run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(duringRegistration('2026-07-10'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('adminAddSignup', () => {
  it('upserts a profile first, then signs the person up, for a first-time player', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));

    const signup = await adminAddSignup({
      sessionId: '2099-01-01',
      email: 'new@dummy.test',
      profile: { fullName: 'New Player', gender: 'Male', savedPositions: 'Catcher' },
      waiverAccepted: true,
    });

    expect(signup.status).toBe('confirmed');
    expect(store.players.get('new@dummy.test')?.fullName).toBe('New Player');
  });

  it('skips the profile upsert when the player already has one', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));
    store.players.set('existing@dummy.test', { email: 'existing@dummy.test', fullName: 'Existing', gender: 'Male', savedPositions: '' });

    await adminAddSignup({ sessionId: '2099-01-01', email: 'existing@dummy.test', waiverAccepted: true });
    expect(store.players.get('existing@dummy.test')?.fullName).toBe('Existing');
  });

  it('routes through the guest path when invitedByName is given', async () => {
    store.sessions.set('2099-01-01', makeSession({ capacity: 5 }));
    const signup = await adminAddSignup({
      sessionId: '2099-01-01',
      email: 'guest@dummy.test',
      profile: { fullName: 'Guest', gender: 'Male', savedPositions: '' },
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
        profile: { fullName: 'New Player', gender: 'Male', savedPositions: '' },
        waiverAccepted: true,
      })
    ).rejects.toThrow(/Signups aren't open/);
  });

  it('requires waiverAccepted even for an admin-added signup', async () => {
    store.sessions.set('2099-01-01', makeSession());
    await expect(
      adminAddSignup({
        sessionId: '2099-01-01',
        email: 'new@dummy.test',
        profile: { fullName: 'New Player', gender: 'Male', savedPositions: '' },
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
      status: 'closed', // created closed; the Monday cron opens it
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
    store.players.set('a@dummy.test', { email: 'a@dummy.test', fullName: 'A', gender: 'Male', savedPositions: '' });
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

/**
 * Regression coverage for
 * adminCreateSession used to hardcode status 'open', and signups are gated on
 * status alone with no date check — so a session created for any future date
 * accepted signups immediately, months early, via a guessable date-shaped id.
 */
describe('a newly created session does not accept signups until it is opened', () => {
  it('is created closed, and rejects a signup', async () => {
    const created = await adminCreateSession({ gameDate: '2027-01-08' }); // a Friday
    expect(created.status).toBe('closed');

    store.players.set('p@dummy.test', makePlayer({ email: 'p@dummy.test' }));
    await expect(signUpForSession('2027-01-08', 'p@dummy.test', true)).rejects.toThrow(/Signups aren't open/);
  });

  it('opens on purpose when asked, but still holds players to the registration window', async () => {
    const created = await adminCreateSession({ gameDate: '2027-01-08', openImmediately: true });
    expect(created.status).toBe('open');

    store.players.set('p@dummy.test', makePlayer({ email: 'p@dummy.test' }));
    // Status is no longer the whole gate. Flipping a session open months
    // early doesn't let players in early — that is the entire point of the
    // window check, and it can't tell a deliberate open from an accidental
    // one. An admin who needs someone in early adds them directly.
    await expect(signUpForSession('2027-01-08', 'p@dummy.test', true)).rejects.toThrow(/opens Mon/);

    await expect(
      adminAddSignup({ sessionId: '2027-01-08', email: 'p@dummy.test', waiverAccepted: true })
    ).resolves.toBeDefined();
  });

  it('lets a player sign up once the window is actually open', async () => {
    await adminCreateSession({ gameDate: '2027-01-08', openImmediately: true });
    store.players.set('p@dummy.test', makePlayer({ email: 'p@dummy.test' }));

    vi.setSystemTime(duringRegistration('2027-01-08'));
    await expect(signUpForSession('2027-01-08', 'p@dummy.test', true)).resolves.toBeDefined();
  });

  it('carries through the price and area set at creation', async () => {
    const created = await adminCreateSession({
      gameDate: '2027-01-08',
      pricePerSpot: 12,
      locationArea: '  Mississauga  ',
    });
    expect(created.pricePerSpot).toBe(12);
    expect(created.locationArea).toBe('Mississauga');
    expect(created.locationName).toBe(''); // field itself not booked yet
  });
});
