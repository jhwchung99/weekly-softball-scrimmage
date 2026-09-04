import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionEmail = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ getSessionEmail }));

const signUpForSession = vi.fn();
const signUpAsGuestForSession = vi.fn();
const getMyStatusForSession = vi.fn();
vi.mock('../../../../../../lib/signupFlow', () => ({ signUpForSession, signUpAsGuestForSession, getMyStatusForSession }));

const withMutationLock = vi.fn((fn: () => unknown) => fn());
vi.mock('../../../../../../lib/lock', () => ({ withMutationLock }));

const { GET, POST } = await import('../route');

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  withMutationLock.mockImplementation((fn: () => unknown) => fn());
});

describe('GET /api/sessions/[sessionId]/signup', () => {
  it('returns 401 when not signed in', async () => {
    getSessionEmail.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(401);
  });

  it('returns the caller\'s status when signed in', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    getMyStatusForSession.mockResolvedValue({ signup: { signupId: 's1' }, incomingSubRequests: [], costOwed: null });

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signup.signupId).toBe('s1');
    expect(getMyStatusForSession).toHaveBeenCalledWith('2099-01-01', 'a@dummy.test');
  });
});

describe('POST /api/sessions/[sessionId]/signup', () => {
  it('returns 401 when not signed in', async () => {
    getSessionEmail.mockResolvedValue(null);
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), makeParams('2099-01-01'));
    expect(res.status).toBe(401);
  });

  it('routes to signUpForSession for a member signup and wraps it in the mutation lock', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    signUpForSession.mockResolvedValue({ signupId: 's1', status: 'confirmed' });

    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ waiverAccepted: true }) }),
      makeParams('2099-01-01')
    );
    expect(res.status).toBe(201);
    expect(withMutationLock).toHaveBeenCalledTimes(1);
    expect(signUpForSession).toHaveBeenCalledWith('2099-01-01', 'a@dummy.test', true);
    expect(signUpAsGuestForSession).not.toHaveBeenCalled();
  });

  it('routes to signUpAsGuestForSession when invitedByName is present', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    signUpAsGuestForSession.mockResolvedValue({ signupId: 's1', status: 'waitlisted' });

    await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ waiverAccepted: true, invitedByName: 'Some Member', willingToShare: true }),
      }),
      makeParams('2099-01-01')
    );
    expect(signUpAsGuestForSession).toHaveBeenCalledWith('2099-01-01', 'a@dummy.test', 'Some Member', true, true);
  });

  it('surfaces a business-logic ApiError with its own status code', async () => {
    const { ApiError } = await import('../../../../../../lib/apiErrors');
    getSessionEmail.mockResolvedValue('a@dummy.test');
    signUpForSession.mockRejectedValue(new ApiError(409, "You're already signed up for this week"));

    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ waiverAccepted: true }) }),
      makeParams('2099-01-01')
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already signed up/);
  });
});
