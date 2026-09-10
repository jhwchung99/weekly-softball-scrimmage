import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSessionsModule, fakeSignupsModule, fakePlayersModule, resetFakeStore, makeSession, makeSignup } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));
vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../sheets/signups', () => fakeSignupsModule(store));
vi.mock('../../sheets/players', () => fakePlayersModule(store));

const sendPush = vi.fn();
vi.mock('../../lib/ntfy', () => ({ sendPush }));
vi.mock('../../lib/gmail', () => ({ sendEmail: vi.fn() }));

const { generateTeams, generateTeamsIfDue, saveTeams, postTeams, teamsFromSignups, teamCountFor } = await import('../teamFlow');

const SESSION = '2026-07-10';
const AFTER_LOCK = new Date('2026-07-10T21:00:00.000Z'); // 5pm ET, past the 1pm cutoff for an 18:00 game
const BEFORE_LOCK = new Date('2026-07-10T12:00:00.000Z');

function seed(playerCount: number, overrides: Partial<ReturnType<typeof makeSession>> = {}) {
  store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, gameTime: '18:00', capacity: 30, ...overrides }));
  for (let i = 0; i < playerCount; i++) {
    const id = `s${i}`;
    store.signups.set(id, makeSignup({ signupId: id, sessionId: SESSION, email: `p${i}@dummy.test`, fullName: `P${i}`, status: 'confirmed', positions: 'Anything' }));
  }
}

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('generateTeamsIfDue', () => {
  it('does nothing before the roster locks', async () => {
    seed(20);
    expect(await generateTeamsIfDue(SESSION, BEFORE_LOCK)).toEqual({ generated: false, reason: 'Roster has not locked yet.' });
    expect(store.sessions.get(SESSION)?.teamsStatus).toBe('');
  });

  it('generates once the lock has passed, and tells the organizer', async () => {
    seed(20);
    expect(await generateTeamsIfDue(SESSION, AFTER_LOCK)).toEqual({ generated: true });
    expect(store.sessions.get(SESSION)?.teamsStatus).toBe('draft');
    expect(sendPush).toHaveBeenCalledWith(expect.stringContaining('Teams ready'), expect.any(String), expect.anything());
  });

  it('is idempotent, so an hourly cron can run all day', async () => {
    seed(20);
    await generateTeamsIfDue(SESSION, AFTER_LOCK);
    sendPush.mockClear();

    const second = await generateTeamsIfDue(SESSION, AFTER_LOCK);
    expect(second.generated).toBe(false);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('skips a cancelled session', async () => {
    seed(20, { status: 'cancelled' });
    expect((await generateTeamsIfDue(SESSION, AFTER_LOCK)).generated).toBe(false);
  });

  it('still saves the teams when the push fails', async () => {
    seed(20);
    sendPush.mockRejectedValue(new Error('ntfy down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await generateTeamsIfDue(SESSION, AFTER_LOCK)).generated).toBe(true);
    expect(store.sessions.get(SESSION)?.teamsStatus).toBe('draft');
    error.mockRestore();
  });
});

describe('generateTeams', () => {
  it('assigns every confirmed player to a team and leaves waitlisted alone', async () => {
    seed(10);
    store.signups.set('w1', makeSignup({ signupId: 'w1', sessionId: SESSION, email: 'w@dummy.test', status: 'waitlisted', positions: 'Anything' }));

    await generateTeams(SESSION);

    const assigned = [...store.signups.values()].filter((s) => s.teamName);
    expect(assigned).toHaveLength(10);
    expect(store.signups.get('w1')?.teamName).toBe('');
  });

  it('makes four teams when two fields are booked', async () => {
    seed(20, { numFields: 2 });
    const teams = await generateTeams(SESSION);
    expect(teams).toHaveLength(4);
    expect(teamCountFor({ numFields: 2 })).toBe(4);
  });
});

describe('saveTeams and postTeams', () => {
  it('writes the edited assignments', async () => {
    seed(4);
    await saveTeams(SESSION, [
      { signupId: 's0', teamName: 'Team 2' },
      { signupId: 's1', teamName: 'Team 2' },
    ]);
    expect(store.signups.get('s0')?.teamName).toBe('Team 2');
    expect(store.sessions.get(SESSION)?.teamsStatus).toBe('draft');
  });

  it('refuses assignments for signups outside this session', async () => {
    seed(2);
    await expect(saveTeams(SESSION, [{ signupId: 'nope', teamName: 'Team 1' }])).rejects.toThrow(/do not belong/);
  });

  it('posting flips only the status, touching no signup row', async () => {
    seed(4);
    await generateTeams(SESSION);
    const before = [...store.signups.values()].map((s) => s.teamName);

    await postTeams(SESSION);

    expect(store.sessions.get(SESSION)?.teamsStatus).toBe('posted');
    expect([...store.signups.values()].map((s) => s.teamName)).toEqual(before);
  });

  it('refuses to post teams that were never generated', async () => {
    seed(4);
    await expect(postTeams(SESSION)).rejects.toThrow(/no teams to post/i);
  });
});

describe('teamsFromSignups', () => {
  it('drops someone who cancelled after teams were posted, so the team plays short', async () => {
    seed(10);
    await generateTeams(SESSION);

    const before = teamsFromSignups([...store.signups.values()], 2);
    expect(before.reduce((n, t) => n + t.members.length, 0)).toBe(10);

    store.signups.set('s0', { ...store.signups.get('s0')!, status: 'cancelled' });

    const after = teamsFromSignups([...store.signups.values()], 2);
    expect(after.reduce((n, t) => n + t.members.length, 0)).toBe(9);
    expect(after.flatMap((t) => t.members).some((m) => m.signupId === 's0')).toBe(false);
  });

  it('projects each member down to the rosterable fields, keeping the rest of the row out of the view', () => {
    // Everything private on one row, so a forwarded row is unmistakable.
    store.signups.set(
      'p1',
      makeSignup({
        signupId: 'p1',
        sessionId: SESSION,
        email: 'private@dummy.test',
        fullName: 'Private Pat',
        gender: 'Female',
        positions: 'Catcher, SS',
        pairId: 'pair-1',
        status: 'confirmed',
        teamName: 'Team 1',
        memberStatus: 'guest',
        invitedByName: 'Inviter Ivy',
        willingToShare: true,
        waiverText: 'I accept all risks.',
        paid: true,
        amountPaid: 17,
        paidAt: '2026-07-01T00:00:00.000Z',
        attended: true,
        subRequestTargetEmail: 'target@dummy.test',
        subRequestStatus: 'pending',
      })
    );

    const [teamOne] = teamsFromSignups([...store.signups.values()], 2);

    expect(teamOne.members).toEqual([
      { signupId: 'p1', fullName: 'Private Pat', gender: 'Female', positions: 'Catcher, SS', pairId: 'pair-1' },
    ]);
  });

  it('keeps the gender the balancer needs, so the view and the generator describe the same player', () => {
    store.signups.set(
      'p1',
      makeSignup({ signupId: 'p1', sessionId: SESSION, fullName: 'F', gender: 'Female', status: 'confirmed', teamName: 'Team 1' })
    );

    const [teamOne] = teamsFromSignups([...store.signups.values()], 2);
    expect(teamOne.members[0].gender).toBe('Female');
  });

  it('still reports what a team cannot cover, since the projection carries positions', () => {
    for (const [id, positions] of [['p1', 'Catcher'], ['p2', 'Anything']] as const) {
      store.signups.set(
        id,
        makeSignup({ signupId: id, sessionId: SESSION, fullName: id, positions, status: 'confirmed', teamName: 'Team 1' })
      );
    }

    const [teamOne] = teamsFromSignups([...store.signups.values()], 2);

    // Two players against a nine-slot lineup: short seven. Which slot the
    // wildcard takes is the matcher's business; what matters here is that the
    // projection kept enough for it to answer at all.
    expect(teamOne.deficiency).toBe(7);
    expect(teamOne.missing).not.toContain('Catcher');
    expect(teamOne.missing).toContain('Rover');
  });
});
