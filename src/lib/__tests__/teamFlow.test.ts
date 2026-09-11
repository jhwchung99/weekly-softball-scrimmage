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

const { generateTeams, saveTeams, postTeams, teamCountFor } = await import('../teamFlow');

const SESSION = '2026-07-10';

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
