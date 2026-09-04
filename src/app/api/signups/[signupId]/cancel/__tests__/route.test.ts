import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionEmail = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ getSessionEmail }));

const isAdminEmail = vi.fn();
vi.mock('../../../../../../sheets/admins', () => ({ isAdminEmail }));

const cancelMySignup = vi.fn();
vi.mock('../../../../../../lib/signupFlow', () => ({ cancelMySignup }));

const withMutationLock = vi.fn((fn: () => unknown) => fn());
vi.mock('../../../../../../lib/lock', () => ({ withMutationLock }));

const { POST } = await import('../route');

function makeParams(signupId: string) {
  return { params: Promise.resolve({ signupId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  withMutationLock.mockImplementation((fn: () => unknown) => fn());
});

describe('POST /api/signups/[signupId]/cancel', () => {
  it('returns 401 when not signed in', async () => {
    getSessionEmail.mockResolvedValue(null);
    const res = await POST(new Request('http://x', { method: 'POST' }), makeParams('s1'));
    expect(res.status).toBe(401);
  });

  it('passes the caller\'s admin status through to cancelMySignup', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    isAdminEmail.mockResolvedValue(true);
    cancelMySignup.mockResolvedValue({ promoted: [] });

    const res = await POST(new Request('http://x', { method: 'POST' }), makeParams('s1'));
    expect(res.status).toBe(200);
    expect(cancelMySignup).toHaveBeenCalledWith('s1', 'a@dummy.test', true);
    expect(withMutationLock).toHaveBeenCalledTimes(1);
  });

  it('returns the promoted list from the response', async () => {
    getSessionEmail.mockResolvedValue('a@dummy.test');
    isAdminEmail.mockResolvedValue(false);
    cancelMySignup.mockResolvedValue({ promoted: [{ signupId: 's2' }] });

    const res = await POST(new Request('http://x', { method: 'POST' }), makeParams('s1'));
    const body = await res.json();
    expect(body.promoted).toEqual([{ signupId: 's2' }]);
  });
});
