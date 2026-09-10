import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionEmail = vi.fn();
vi.mock('../../../../lib/auth', () => ({ getSessionEmail }));

const getSessionByAnyId = vi.fn();
vi.mock('../../../../sheets/sessions', () => ({ getSessionByAnyId }));

const listSignupsForSession = vi.fn();
vi.mock('../../../../sheets/signups', () => ({ listSignupsForSession }));

const getPlayer = vi.fn();
vi.mock('../../../../sheets/players', () => ({ getPlayer }));

const { GET } = await import('../route');

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

beforeEach(() => {
  vi.clearAllMocks();
  getSessionByAnyId.mockResolvedValue(SESSION);
  listSignupsForSession.mockResolvedValue([]);
  getPlayer.mockResolvedValue(null);
});

describe('GET /api/home', () => {
  it('reads each tab exactly once for a signed-in visitor', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');

    await GET();

    // The whole point of this endpoint: 3 reads, not 5.
    expect(getSessionByAnyId).toHaveBeenCalledTimes(1);
    expect(listSignupsForSession).toHaveBeenCalledTimes(1);
    expect(getPlayer).toHaveBeenCalledTimes(1);
  });

  it('returns only public data when signed out, touching just one tab', async () => {
    getSessionEmail.mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(body.session.sessionId).toBe('2099-01-01');
    expect(body.signedIn).toBe(false);
    expect(body.player).toBeNull();
    expect(body.signup).toBeNull();
    expect(body.roster).toBeNull();
    expect(body.waiverText).toBeTruthy();
    // Signed out means no reason to read Signups or Players at all.
    expect(listSignupsForSession).not.toHaveBeenCalled();
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
    getSessionByAnyId.mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(body.session).toBeNull();
    expect(listSignupsForSession).not.toHaveBeenCalled();
  });

  it('returns the caller\'s own signup, cost share and roster names', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    getSessionByAnyId.mockResolvedValue({ ...SESSION, pricePerSpot: 10 });
    getPlayer.mockResolvedValue({ email: 'a@dummy.test', fullName: 'A', gender: 'x', savedPositions: '' });
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A' }),
      signup({ email: 'b@dummy.test', fullName: 'B' }),
    ]);

    const body = await (await GET()).json();

    expect(body.signedIn).toBe(true);
    expect(body.player.fullName).toBe('A');
    // Not `email`: the caller's own signup is projected too, and the browser
    // already knows who it is signed in as.
    expect(body.signup.signupId).toBeTruthy();
    expect(body.signup).not.toHaveProperty('email');
    expect(body.costOwed).toBe(10); // the fixed price for one spot
    expect(body.roster.confirmedCount).toBe(2);
    expect(body.roster.confirmed.map((e: { fullName: string }) => e.fullName)).toEqual(['A', 'B']);
  });

  it('applies the same roster gate as the standalone route', async () => {
    getSessionEmail.mockResolvedValue('outsider@dummy.test');
    listSignupsForSession.mockResolvedValue([signup({ email: 'a@dummy.test', fullName: 'A' })]);

    const body = await (await GET()).json();

    expect(body.roster.confirmedCount).toBe(1);
    expect(body.roster.confirmed).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/"A"/);
  });

  it('surfaces incoming sub requests addressed to the caller', async () => {
    getSessionEmail.mockResolvedValue('target@dummy.test');
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'target@dummy.test', fullName: 'Target' }),
      signup({
        email: 'asker@dummy.test',
        fullName: 'Asker',
        status: 'waitlisted',
        subRequestStatus: 'pending',
        subRequestTargetEmail: 'target@dummy.test',
      }),
    ]);

    const body = await (await GET()).json();

    // A member subbing in, not a guest naming their inviter.
    expect(body.incomingSubRequests).toEqual([
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
    getSessionByAnyId.mockResolvedValue(POSTED);
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', teamName: 'Team 1' }),
      teammate(),
    ]);

    const body = await (await GET()).json();

    const mate = body.teams.flatMap((t: { members: unknown[] }) => t.members).find((m: { fullName: string }) => m.fullName === 'Mate');
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
    getSessionByAnyId.mockResolvedValue(POSTED);
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', teamName: 'Team 1' }),
      teammate(),
    ]);

    const body = await (await GET()).json();

    const serialized = JSON.stringify(body.teams);
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
    getSessionByAnyId.mockResolvedValue(POSTED);
    listSignupsForSession.mockResolvedValue([
      signup({ signupId: 'me-1', email: 'a@dummy.test', fullName: 'A', positions: 'Rover', teamName: 'Team 1' }),
      teammate({ pairId: 'pair-9' }),
      teammate({ signupId: 'mate-2', email: 'mate2@dummy.test', fullName: 'Mate Two', pairId: 'pair-9' }),
    ]);

    const body = await (await GET()).json();

    const teamOne = body.teams.find((t: { name: string }) => t.name === 'Team 1');
    expect(teamOne.members.map((m: { fullName: string }) => m.fullName)).toEqual(['A', 'Mate', 'Mate Two']);
    expect(teamOne.members.map((m: { positions: string }) => m.positions)).toEqual(['Rover', 'Catcher, SS', 'Catcher, SS']);
    // Sharing a spot still reads correctly on the lineup.
    expect(teamOne.members.filter((m: { pairId: string }) => m.pairId === 'pair-9')).toHaveLength(2);
  });

  it('sends no teams to a signed-in caller who has no signup for the week', async () => {
    getSessionEmail.mockResolvedValue('outsider@dummy.test');
    getSessionByAnyId.mockResolvedValue(POSTED);
    listSignupsForSession.mockResolvedValue([teammate()]);

    const body = await (await GET()).json();

    expect(body.teams).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/Mate/);
  });

  it('sends no teams to a signed-out visitor', async () => {
    getSessionEmail.mockResolvedValue(null);
    getSessionByAnyId.mockResolvedValue(POSTED);

    const body = await (await GET()).json();

    expect(body.teams).toBeNull();
  });
});
