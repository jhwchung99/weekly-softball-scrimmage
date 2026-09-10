import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../../../../../lib/apiErrors';

const requireSignedIn = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireSignedIn }));

const signUpForSession = vi.fn();
const signUpAsGuestForSession = vi.fn();
const getMyStatusForSession = vi.fn();
vi.mock('../../../../../../lib/signupFlow', () => ({ signUpForSession, signUpAsGuestForSession, getMyStatusForSession }));


const { GET, POST } = await import('../route');

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/sessions/[sessionId]/signup', () => {
  it('returns 401 when not signed in', async () => {
    requireSignedIn.mockRejectedValue(new ApiError(401, 'Not signed in.'));
    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(401);
  });

  it('returns the caller\'s status when signed in', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
    getMyStatusForSession.mockResolvedValue({
      signup: { signupId: 's1' },
      incomingSubRequests: [],
      costOwed: null,
      waitlistPosition: null,
    });

    const res = await GET(new Request('http://x'), makeParams('2099-01-01'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signup.signupId).toBe('s1');
    expect(getMyStatusForSession).toHaveBeenCalledWith('2099-01-01', 'a@dummy.test');
  });

  /**
   * The status builder promises four fields and this route forwarded three,
   * dropping the caller's place in the queue — so a waitlisted player asking
   * this route was told nothing about where they stood, while the same player
   * on the homepage was told exactly.
   *
   * The old test mocked a return value that omitted the field too, so it
   * encoded the drift rather than catching it. That is why this asserts the
   * whole payload rather than one key: a field the builder promises has to
   * arrive, and picking them off individually is how one goes missing again.
   */
  it('tells a waitlisted caller their place in the queue', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
    getMyStatusForSession.mockResolvedValue({
      signup: { signupId: 's1', status: 'waitlisted' },
      incomingSubRequests: [],
      costOwed: null,
      waitlistPosition: 3,
    });

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();

    expect(body.waitlistPosition).toBe(3);
  });

  it('forwards every field the status builder promises, so none can be dropped again', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
    const status = {
      signup: { signupId: 's1', status: 'waitlisted' },
      incomingSubRequests: [{ fromSignupId: 's2', fromFullName: 'Asker', fromGuestInvite: false }],
      costOwed: 10,
      waitlistPosition: 2,
    };
    getMyStatusForSession.mockResolvedValue(status);

    const body = await (await GET(new Request('http://x'), makeParams('2099-01-01'))).json();

    expect(body).toEqual(status);
  });
});

describe('POST /api/sessions/[sessionId]/signup', () => {
  it('returns 401 when not signed in', async () => {
    requireSignedIn.mockRejectedValue(new ApiError(401, 'Not signed in.'));
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), makeParams('2099-01-01'));
    expect(res.status).toBe(401);
  });

  it('routes to signUpForSession for a member signup', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
    signUpForSession.mockResolvedValue({ signupId: 's1', status: 'confirmed' });

    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ waiverAccepted: true }) }),
      makeParams('2099-01-01')
    );
    expect(res.status).toBe(201);
    expect(signUpForSession).toHaveBeenCalledWith('2099-01-01', 'a@dummy.test', true);
    expect(signUpAsGuestForSession).not.toHaveBeenCalled();
  });

  it('routes to signUpAsGuestForSession when invitedByName is present', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
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
    requireSignedIn.mockResolvedValue('a@dummy.test');
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
