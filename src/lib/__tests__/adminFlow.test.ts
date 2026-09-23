import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makePlayer , duringRegistration} from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/ntfy', () => ({ sendPush: vi.fn() }));

const { adminAddSignup, adminCreateSession, adminRescheduleSession, reviseSession } = await import('../adminFlow');
const { signUpForSession } = await import('../signupFlow');
const { updateSession } = await import('../../sheets/sessions');
const { listSignupsForSession, batchUpdateSignups } = await import('../../sheets/signups');

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

  // Any weekday is allowed now. What replaced the allowlist is the ordering
  // rule: a Monday game's *derived* window closes after the game has been
  // played, so it has to bring its own.
  it('accepts a midweek game, which the old weekday allowlist refused', async () => {
    const session = await adminCreateSession({ gameDate: '2026-07-08' }); // Wednesday

    expect(session.gameDate).toBe('2026-07-08');
  });

  it('refuses a Monday game with no registration window of its own', async () => {
    await expect(adminCreateSession({ gameDate: '2026-07-06' })).rejects.toThrow(/needs its own registration times/);
  });

  it('accepts a Monday game that brings its own window', async () => {
    const session = await adminCreateSession({
      gameDate: '2026-07-06',
      gameTime: '18:00',
      registrationOpensAt: '2026-06-29T13:00:00.000Z', // the Monday before, 9am ET
      registrationClosesAt: '2026-07-04T04:00:00.000Z', // Saturday midnight ET
    });

    expect(session.gameDate).toBe('2026-07-06');
    expect(session.registrationClosesAt).toBe('2026-07-04T04:00:00.000Z');
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

  // The ordering rule deliberately lives in reviseSession, not here: this
  // function sees only the new date and time, while a move to a Monday is
  // legitimate in the same request that supplies the window to go with it.
  // reviseSession is the layer holding both. See the ordering tests below.
  it('accepts any weekday, leaving the schedule rule to reviseSession', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10' }));

    const moved = await adminRescheduleSession('2026-07-10', '2026-07-08', '18:00'); // Wednesday

    expect(moved.gameDate).toBe('2026-07-08');
  });

  it('rejects rescheduling a session that does not exist', async () => {
    await expect(adminRescheduleSession('2026-07-10', '2026-07-11', '18:00')).rejects.toThrow(/No such session/);
  });

  // A move is two writes, and Sheets can fail between them. Whichever one
  // fails, pressing save again with the id the dashboard still holds has to
  // finish the move rather than 404 on a session that already moved.
  describe('when Sheets fails partway through a move', () => {
    async function sessionWithSignup() {
      store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', capacity: 5 }));
      store.players.set('a@dummy.test', { email: 'a@dummy.test', fullName: 'A', gender: 'Male', savedPositions: '' });
      return signUpForSession('2026-07-10', 'a@dummy.test', true);
    }

    it('reading the signups fails: nothing has been written', async () => {
      const signup = await sessionWithSignup();
      vi.mocked(listSignupsForSession).mockRejectedValueOnce(new Error('quota'));

      await expect(adminRescheduleSession('2026-07-10', '2026-07-11', '20:00')).rejects.toThrow('quota');

      expect(store.sessions.has('2026-07-10')).toBe(true);
      expect(store.signups.get(signup.signupId)?.sessionId).toBe('2026-07-10');
    });

    it('moving the signups fails: the session keeps its id, and a retry finishes', async () => {
      const signup = await sessionWithSignup();
      vi.mocked(batchUpdateSignups).mockRejectedValueOnce(new Error('quota'));

      await expect(adminRescheduleSession('2026-07-10', '2026-07-11', '20:00')).rejects.toThrow('quota');
      expect(store.sessions.has('2026-07-10')).toBe(true);

      await adminRescheduleSession('2026-07-10', '2026-07-11', '20:00');
      expect(store.sessions.has('2026-07-11')).toBe(true);
      expect(store.signups.get(signup.signupId)?.sessionId).toBe('2026-07-11');
    });

    it('rekeying the session fails after the signups moved: a retry finishes', async () => {
      const signup = await sessionWithSignup();
      vi.mocked(updateSession).mockRejectedValueOnce(new Error('quota'));

      await expect(adminRescheduleSession('2026-07-10', '2026-07-11', '20:00')).rejects.toThrow('quota');
      expect(store.sessions.has('2026-07-10')).toBe(true);

      await adminRescheduleSession('2026-07-10', '2026-07-11', '20:00');
      expect(store.sessions.has('2026-07-10')).toBe(false);
      expect(store.sessions.get('2026-07-11')?.gameTime).toBe('20:00');
      expect(store.signups.get(signup.signupId)?.sessionId).toBe('2026-07-11');
    });
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
    await expect(signUpForSession('2027-01-08', 'p@dummy.test', true)).rejects.toThrow(/open Monday/);

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

describe('reviseSession — the schedule must come in order', () => {
  const GAME = '2026-07-11'; // Saturday
  const reviseFrom = (over: Record<string, unknown>, updates: Record<string, unknown>) => {
    const session = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00', ...over });
    store.sessions.set(GAME, session);
    return reviseSession(GAME, session, { updates } as Parameters<typeof reviseSession>[2]);
  };

  it('refuses a close that is not after the open', async () => {
    await expect(
      reviseFrom(
        { registrationOpensAt: '2026-07-07T13:00:00.000Z' },
        { registrationClosesAt: '2026-07-06T13:00:00.000Z' }
      )
    ).rejects.toThrow(/which is not after it opens/);
  });

  it('refuses a lock that falls before registration closes', async () => {
    // The lock is what stops the roster moving, so it cannot come first.
    await expect(
      reviseFrom(
        { registrationClosesAt: '2026-07-10T04:00:00.000Z' },
        { rosterLockAt: '2026-07-09T04:00:00.000Z' }
      )
    ).rejects.toThrow(/before registration closes/);
  });

  it('refuses moving a game to a Monday without giving it a window', async () => {
    // gameDate is a top-level field of the revision, not one of `updates` —
    // it can rekey the row, so reviseSession handles it separately.
    const session = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00' });
    store.sessions.set(GAME, session);

    await expect(
      reviseSession(GAME, session, { gameDate: '2026-07-06', gameTime: '18:00', updates: {} } as Parameters<
        typeof reviseSession
      >[2])
    ).rejects.toThrow(/needs its own registration times/);
  });

  it('accepts a window and a move to Monday supplied together', async () => {
    const session = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00' });
    store.sessions.set(GAME, session);

    const { session: revised } = await reviseSession(GAME, session, {
      gameDate: '2026-07-06',
      gameTime: '18:00',
      updates: {
        registrationOpensAt: '2026-06-29T13:00:00.000Z',
        registrationClosesAt: '2026-07-04T04:00:00.000Z',
      },
    } as Parameters<typeof reviseSession>[2]);

    expect(revised.gameDate).toBe('2026-07-06');
  });

  it('writes a move and its field edits to the row together', async () => {
    // Two writes let the edits be lost after the row had already rekeyed, and
    // a retry from the dashboard, still holding the old id, then 404s.
    const session = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00' });
    store.sessions.set(GAME, session);

    await reviseSession(GAME, session, {
      gameDate: '2026-07-12',
      gameTime: '18:00',
      updates: { locationName: 'Field 3' },
    } as Parameters<typeof reviseSession>[2]);

    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(store.sessions.get('2026-07-12')?.locationName).toBe('Field 3');
  });

  it('leaves an ordinary weekend session alone', async () => {
    const { session } = await reviseFrom({}, { capacity: 18 });

    expect(session.capacity).toBe(18);
  });
});

describe('reviseSession — the roster lock', () => {
  const GAME = '2026-07-11'; // Saturday
  const revise = (updates: Record<string, unknown>, over: Record<string, unknown> = {}) => {
    const session = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '10:00', ...over });
    store.sessions.set(GAME, session);
    return reviseSession(GAME, session, { updates } as Parameters<typeof reviseSession>[2]);
  };

  it('accepts a lock the evening before, which is the point of the field', async () => {
    // 8pm ET Friday, for a 10am Saturday game.
    const { session } = await revise({ rosterLockAt: '2026-07-11T00:00:00.000Z' });

    expect(session.rosterLockAt).toBe('2026-07-11T00:00:00.000Z');
  });

  it('refuses a lock at or after the first pitch, which would stop payment ever opening', async () => {
    // Noon on game day, two hours after a 10am game starts. Without this the
    // session never reaches 'locked': payment would stay shut and the game-day
    // email would refuse to send all day, with nothing saying why.
    await expect(revise({ rosterLockAt: '2026-07-11T16:00:00.000Z' })).rejects.toThrow(/not before the game starts/i);
  });

  it('catches a reschedule that moves the game to before its own lock', async () => {
    // The lock is untouched and already valid; it is the new game time that
    // makes the pair incoherent, so the check has to run against the week as
    // it will be, not as it was.
    const session = makeSession({
      sessionId: GAME,
      gameDate: GAME,
      gameTime: '10:00',
      rosterLockAt: '2026-07-11T00:00:00.000Z', // 8pm Friday
    });
    store.sessions.set(GAME, session);

    // Moved back to the Friday, 10am — which is now earlier in the day than
    // the 8pm Friday lock it still carries.
    await expect(
      reviseSession(GAME, session, { updates: {}, gameDate: '2026-07-10', gameTime: '10:00' } as Parameters<typeof reviseSession>[2])
    ).rejects.toThrow(/not before the game starts/i);
  });

  it('leaves a session with no lock of its own alone', async () => {
    const { session } = await revise({ capacity: 12 });

    expect(session.rosterLockAt).toBe('');
    expect(session.capacity).toBe(12);
  });
});
