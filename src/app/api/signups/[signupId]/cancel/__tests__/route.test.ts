import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../../../../../lib/apiErrors';

const requireSignedIn = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireSignedIn }));

const isAdminEmail = vi.fn();
vi.mock('../../../../../../sheets/admins', () => ({ isAdminEmail }));

const cancelMySignup = vi.fn();
vi.mock('../../../../../../lib/signupFlow', () => ({ cancelMySignup }));


const { POST } = await import('../route');

function makeParams(signupId: string) {
  return { params: Promise.resolve({ signupId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/signups/[signupId]/cancel', () => {
  it('returns 401 when not signed in', async () => {
    requireSignedIn.mockRejectedValue(new ApiError(401, 'Not signed in.'));
    const res = await POST(new Request('http://x', { method: 'POST' }), makeParams('s1'));
    expect(res.status).toBe(401);
  });

  it('passes the caller\'s admin status through to cancelMySignup', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
    isAdminEmail.mockResolvedValue(true);
    cancelMySignup.mockResolvedValue({ promoted: [] });

    const res = await POST(new Request('http://x', { method: 'POST' }), makeParams('s1'));
    expect(res.status).toBe(200);
    expect(cancelMySignup).toHaveBeenCalledWith('s1', 'a@dummy.test', true);
  });

  it('returns the promoted list from the response', async () => {
    requireSignedIn.mockResolvedValue('a@dummy.test');
    isAdminEmail.mockResolvedValue(false);
    cancelMySignup.mockResolvedValue({ promoted: [{ signupId: 's2' }] });

    const res = await POST(new Request('http://x', { method: 'POST' }), makeParams('s1'));
    const body = await res.json();
    expect(body.promoted).toEqual([{ signupId: 's2' }]);
  });
});
