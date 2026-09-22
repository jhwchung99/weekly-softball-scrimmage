import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionEmail = vi.fn();
vi.mock('../../../../lib/auth', () => ({ getSessionEmail }));

const listSessions = vi.fn();
vi.mock('../../../../sheets/sessions', () => ({ listSessions }));

// Grouped rather than per-session: the route reads the Signups tab once for
// every upcoming session, which is what keeps a page load at three reads.
const listSignupsForSessions = vi.fn();
vi.mock('../../../../sheets/signups', () => ({ listSignupsForSessions }));

const getPlayer = vi.fn();
vi.mock('../../../../sheets/players', () => ({ getPlayer }));

const { GET } = await import('../route');
// Imported after the mocks, not at the top: this module imports sheets/sessions,
// and pulling it in early evaluates the mock factory before its vi.fn exists.
const { forgetCurrentWeek } = await import('../../../../lib/currentWeek');

const SESSION = { sessionId: '2099-01-01', gameDate: '2099-01-01', gameTime: '18:00', capacity: 10, status: 'open', cost: 0 };

function signup(over: Record<string, unknown> = {}) {
  return {
    signupId: 'id-' + Math.random().toString(36).slice(2),
    sessionId: '2099-01-01',
    email: 'someone@dummy.test',
    fullName: 'Someone',
    positions: '',
    pairId: '',
    status: 'confirmed',
    timestamp: '2099-01-01T00:00:00.000Z',
    subRequestStatus: '',
    subRequestTargetEmail: '',
    ...over,
  };
}

/**
 * The first upcoming session's entry.
 *
 * `/api/home` returns one entry per upcoming session as of 2026-09-22, where
 * it used to return a single session's fields at the top level. Every case
 * here concerns one session, so this unwraps it rather than restating the
 * shape in twenty places.
 */
// A parsed HTTP body, asserted field by field below; typing it adds nothing.
function first(body: { sessions: any[] }): any {
  return body.sessions[0];
}

beforeEach(() => {
  // This route reads the week through a cache; each case starts cold.
  forgetCurrentWeek();
  vi.clearAllMocks();
  listSessions.mockResolvedValue([SESSION]);
  listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', []]]));
  getPlayer.mockResolvedValue(null);
});

describe('GET /api/home', () => {
  it('reads each tab exactly once for a signed-in visitor', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');

    await GET();

    // The whole point of this endpoint: 3 reads, not 5.
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(listSignupsForSessions).toHaveBeenCalledTimes(1);
    expect(getPlayer).toHaveBeenCalledTimes(1);
  });

  it('returns only public data when signed out, touching just one tab', async () => {
    getSessionEmail.mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(first(body).session.sessionId).toBe('2099-01-01');
    expect(body.signedIn).toBe(false);
    expect(body.player).toBeNull();
    expect(first(body).signup).toBeNull();
    expect(first(body).roster).toBeNull();
    expect(body.waiverText).toBeTruthy();
    // Signed out means no reason to read Signups or Players at all.
    expect(listSignupsForSessions).not.toHaveBeenCalled();
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it('does not hand the payment address to a signed-out caller', async () => {
    process.env.PAYMENT_INSTRUCTIONS = 'e-Transfer to organizer@example.com';
    getSessionEmail.mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(body.paymentInstructions).toBe('');
    expect(JSON.stringify(body)).not.toMatch(/organizer@example\.com/);
  });

  it('sends the payment address to a signed-in caller', async () => {
    process.env.PAYMENT_INSTRUCTIONS = 'e-Transfer to organizer@example.com';
    getSessionEmail.mockResolvedValue('a@dummy.test');

    const body = await (await GET()).json();

    expect(body.paymentInstructions).toBe('e-Transfer to organizer@example.com');
  });

  it('skips the extra reads when no session exists for the week', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSessions.mockResolvedValue([]);

    const body = await (await GET()).json();

    expect(body.sessions).toEqual([]);
    expect(listSignupsForSessions).not.toHaveBeenCalled();
  });

  it('returns the caller\'s own signup, cost share and roster names', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSessions.mockResolvedValue([{ ...SESSION, pricePerSpot: 10 }]);
    getPlayer.mockResolvedValue({ email: 'a@dummy.test', fullName: 'A', gender: 'x', savedPositions: '' });
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [
      signup({ email: 'a@dummy.test', fullName: 'A' }),
      signup({ email: 'b@dummy.test', fullName: 'B' }),
    ]]]));

    const body = await (await GET()).json();

    expect(body.signedIn).toBe(true);
    expect(body.player.fullName).toBe('A');
    // Not `email`: the caller's own signup is projected too, and the browser
    // already knows who it is signed in as.
    expect(first(body).signup.signupId).toBeTruthy();
    expect(first(body).signup).not.toHaveProperty('email');
    expect(first(body).costOwed).toBe(10); // the fixed price for one spot
    expect(first(body).roster.confirmedCount).toBe(2);
    expect(first(body).roster.confirmed.map((e: { fullName: string }) => e.fullName)).toEqual(['A', 'B']);
  });

  it('applies the same roster gate as the standalone route', async () => {
    getSessionEmail.mockResolvedValue('outsider@dummy.test');
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [signup({ email: 'a@dummy.test', fullName: 'A' })]]]));

    const body = await (await GET()).json();

    expect(first(body).roster.confirmedCount).toBe(1);
    expect(first(body).roster.confirmed).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/"A"/);
  });

  it('surfaces incoming sub requests addressed to the caller', async () => {
    getSessionEmail.mockResolvedValue('target@dummy.test');
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [
      signup({ email: 'target@dummy.test', fullName: 'Target' }),
      signup({
        email: 'asker@dummy.test',
        fullName: 'Asker',
        status: 'waitlisted',
        subRequestStatus: 'pending',
        subRequestTargetEmail: 'target@dummy.test',
      }),
    ]]]));

    const body = await (await GET()).json();

    // A member subbing in, not a guest naming their inviter.
    expect(first(body).incomingSubRequests).toEqual([
      { fromSignupId: expect.any(String), fromFullName: 'Asker', fromGuestInvite: false },
    ]);
  });
});

/**
 * The teams payload is the second place roster data leaves the server, and it
 * has to honour the same promise the roster payload does: a lineup, and
 * nothing about anyone's identity, money or history. Read this alongside the
 * standalone roster route's "never returns email addresses" test — they are
 * the same assertion applied to the two payloads that carry other people.
 */
describe('GET /api/home — the teams payload', () => {
  const POSTED = { ...SESSION, numFields: 1, teamsStatus: 'posted' };

  /** A teammate with every private field filled in, so a leak has something
   * recognisable to leak. */
  function teammate(over: Record<string, unknown> = {}) {
    return signup({
      signupId: 'mate-1',
      email: 'mate@dummy.test',
      fullName: 'Mate',
      gender: 'Female',
      positions: 'Catcher, SS',
      memberStatus: 'guest',
      invitedByName: 'Inviter Ivy',
      willingToShare: true,
      waiverAcceptedAt: '2099-01-01T00:00:00.000Z',
      waiverText: 'I accept all risks of playing softball.',
      paid: true,
      amountPaid: 17,
      paidAt: '2099-01-02T00:00:00.000Z',
      attended: true,
      subRequestTargetEmail: 'target@dummy.test',
      subRequestStatus: 'pending',
      subRequestedAt: '2099-01-03T00:00:00.000Z',
      teamName: 'Team 1',
      ...over,
    });
  }

  it('sends a teammate only their name, gender, positions and shared-spot id', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSessions.mockResolvedValue([POSTED]);
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [
      signup({ email: 'a@dummy.test', fullName: 'A', teamName: 'Team 1' }),
      teammate(),
    ]]]));

    const body = await (await GET()).json();

    const mate = first(body).teams.flatMap((t: { members: unknown[] }) => t.members).find((m: { fullName: string }) => m.fullName === 'Mate');
    expect(mate).toEqual({
      signupId: 'mate-1',
      fullName: 'Mate',
      gender: 'Female',
      positions: 'Catcher, SS',
      pairId: '',
    });
  });

  it('keeps every private field off the wire, so the leak cannot come back one key at a time', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSessions.mockResolvedValue([POSTED]);
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [
      signup({ email: 'a@dummy.test', fullName: 'A', teamName: 'Team 1' }),
      teammate(),
    ]]]));

    const body = await (await GET()).json();

    const serialized = JSON.stringify(first(body).teams);
    for (const key of [
      'email',
      'paid',
      'amountPaid',
      'paidAt',
      'attended',
      'waiverText',
      'waiverAcceptedAt',
      'subRequestTargetEmail',
      'subRequestStatus',
      'subRequestedAt',
      'memberStatus',
      'invitedByName',
      'willingToShare',
      'status',
      'timestamp',
      'sessionId',
      'teamName',
    ]) {
      expect(serialized).not.toMatch(new RegExp(`"${key}"`));
    }
    // And the values themselves, in case a key is ever renamed on the way out.
    expect(serialized).not.toMatch(/dummy\.test/);
    expect(serialized).not.toMatch(/I accept all risks/);
    expect(serialized).not.toMatch(/Inviter Ivy/);
  });

  it('still tells a player who they are playing with and what they cover', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSessions.mockResolvedValue([POSTED]);
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [
      signup({ signupId: 'me-1', email: 'a@dummy.test', fullName: 'A', positions: 'Rover', teamName: 'Team 1' }),
      teammate({ pairId: 'pair-9' }),
      teammate({ signupId: 'mate-2', email: 'mate2@dummy.test', fullName: 'Mate Two', pairId: 'pair-9' }),
    ]]]));

    const body = await (await GET()).json();

    const teamOne = first(body).teams.find((t: { name: string }) => t.name === 'Team 1');
    expect(teamOne.members.map((m: { fullName: string }) => m.fullName)).toEqual(['A', 'Mate', 'Mate Two']);
    expect(teamOne.members.map((m: { positions: string }) => m.positions)).toEqual(['Rover', 'Catcher, SS', 'Catcher, SS']);
    // Sharing a spot still reads correctly on the lineup.
    expect(teamOne.members.filter((m: { pairId: string }) => m.pairId === 'pair-9')).toHaveLength(2);
  });

  it('sends no teams to a signed-in caller who has no signup for the week', async () => {
    getSessionEmail.mockResolvedValue('outsider@dummy.test');
    listSessions.mockResolvedValue([POSTED]);
    listSignupsForSessions.mockResolvedValue(new Map([['2099-01-01', [teammate()]]]));

    const body = await (await GET()).json();

    expect(first(body).teams).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/Mate/);
  });

  it('sends no teams to a signed-out visitor', async () => {
    getSessionEmail.mockResolvedValue(null);
    listSessions.mockResolvedValue([POSTED]);

    const body = await (await GET()).json();

    expect(first(body).teams).toBeNull();
  });
});
