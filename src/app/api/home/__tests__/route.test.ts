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

  it('skips the extra reads when no session exists for the week', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    getSessionByAnyId.mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(body.session).toBeNull();
    expect(listSignupsForSession).not.toHaveBeenCalled();
  });

  it('returns the caller\'s own signup, cost share and roster names', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    getSessionByAnyId.mockResolvedValue({ ...SESSION, cost: 20 });
    getPlayer.mockResolvedValue({ email: 'a@dummy.test', fullName: 'A', gender: 'x', savedPositions: '' });
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A' }),
      signup({ email: 'b@dummy.test', fullName: 'B' }),
    ]);

    const body = await (await GET()).json();

    expect(body.signedIn).toBe(true);
    expect(body.player.fullName).toBe('A');
    expect(body.signup.email).toBe('a@dummy.test');
    expect(body.costOwed).toBe(10); // $20 across two confirmed slots
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

    expect(body.incomingSubRequests).toEqual([{ fromSignupId: expect.any(String), fromFullName: 'Asker' }]);
  });
});
