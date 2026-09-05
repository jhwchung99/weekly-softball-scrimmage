import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionEmail = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ getSessionEmail }));

const listSignupsForSession = vi.fn();
vi.mock('../../../../../../sheets/signups', () => ({ listSignupsForSession }));

const { GET } = await import('../route');

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function signup(over: Partial<Record<string, unknown>> = {}) {
  return {
    signupId: 'id-' + Math.random().toString(36).slice(2),
    sessionId: '2099-01-01',
    email: 'someone@dummy.test',
    fullName: 'Someone',
    positions: 'Rover',
    pairId: '',
    status: 'confirmed',
    timestamp: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/sessions/[sessionId]/roster', () => {
  it('requires sign-in', async () => {
    getSessionEmail.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(401);
  });

  it('hides names but shows counts for a signed-in viewer with no signup', async () => {
    getSessionEmail.mockResolvedValue('outsider@dummy.test');
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', status: 'confirmed' }),
      signup({ email: 'b@dummy.test', fullName: 'B', status: 'confirmed' }),
      signup({ email: 'c@dummy.test', fullName: 'C', status: 'waitlisted' }),
    ]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();

    expect(body.confirmedCount).toBe(2);
    expect(body.waitlistedCount).toBe(1);
    expect(body.confirmed).toBeNull();
    expect(body.waitlisted).toBeNull();
    // The whole point: no names anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/"A"|"B"|"C"/);
  });

  it('shows names to a viewer who has an active signup', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', status: 'confirmed' }),
      signup({ email: 'c@dummy.test', fullName: 'C', status: 'waitlisted' }),
    ]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();

    expect(body.confirmed.map((e: { fullName: string }) => e.fullName)).toEqual(['A']);
    expect(body.waitlisted.map((e: { fullName: string }) => e.fullName)).toEqual(['C']);
  });

  it('shows names to a waitlisted viewer too — they need it to pick a sub target', async () => {
    getSessionEmail.mockResolvedValue('c@dummy.test');
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', status: 'confirmed' }),
      signup({ email: 'c@dummy.test', fullName: 'C', status: 'waitlisted' }),
    ]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();
    expect(body.confirmed).toHaveLength(1);
  });

  it('re-hides names once the viewer cancels', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', status: 'cancelled' }),
      signup({ email: 'b@dummy.test', fullName: 'B', status: 'confirmed' }),
    ]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();

    expect(body.confirmed).toBeNull();
    expect(body.confirmedCount).toBe(1); // cancelled rows don't count toward it either
  });

  it('matches the viewer case-insensitively', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSignupsForSession.mockResolvedValue([signup({ email: 'A@Dummy.Test', fullName: 'A', status: 'confirmed' })]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();
    expect(body.confirmed).toHaveLength(1);
  });

  it('never returns email addresses, even to a participant', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSignupsForSession.mockResolvedValue([signup({ email: 'a@dummy.test', fullName: 'A' })]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();
    expect(JSON.stringify(body)).not.toMatch(/dummy\.test/);
  });

  it('orders the waitlist by signup time', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'a@dummy.test', fullName: 'A', status: 'confirmed' }),
      signup({ fullName: 'Later', status: 'waitlisted', timestamp: '2099-01-02T00:00:00.000Z' }),
      signup({ fullName: 'Earlier', status: 'waitlisted', timestamp: '2099-01-01T00:00:00.000Z' }),
    ]);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();
    expect(body.waitlisted.map((e: { fullName: string }) => e.fullName)).toEqual(['Earlier', 'Later']);
  });
});
