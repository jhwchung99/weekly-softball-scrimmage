import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin }));

const getSignup = vi.fn();
const updateSignup = vi.fn();
const deleteSignup = vi.fn();
const listSignupsForSession = vi.fn();
vi.mock('../../../../../../sheets/signups', () => ({
  getSignup,
  updateSignup,
  deleteSignup,
  listSignupsForSession,
}));

const getSession = vi.fn();
vi.mock('../../../../../../sheets/sessions', () => ({ getSession }));

const { PATCH } = await import('../route');

function makeParams(signupId: string) {
  return { params: Promise.resolve({ signupId }) };
}

function patch(signupId: string, body: unknown) {
  return PATCH(
    new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }),
    makeParams(signupId)
  );
}

const signup = (overrides: Record<string, unknown> = {}) => ({
  signupId: 'old',
  sessionId: '2099-01-01',
  email: 'kevin@dummy.test',
  fullName: 'Kevin Kim',
  status: 'cancelled',
  pairId: '',
  paid: false,
  amountPaid: 0,
  subRequestStatus: '',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue('admin@dummy.test');
  updateSignup.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({ signupId: id, ...updates }));
});

describe('PATCH /api/admin/signups/[signupId] — reviving a cancelled row', () => {
  it('refuses when the same person already has an active signup, naming the conflict', async () => {
    // Kevin cancelled and signed up again; 'old' is the stale row.
    getSignup.mockResolvedValue(signup());
    listSignupsForSession.mockResolvedValue([
      signup(),
      signup({ signupId: 'new', status: 'confirmed' }),
    ]);

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Kevin Kim already has an active signup/);
    expect(body.error).toMatch(/confirmed/);
    expect(updateSignup).not.toHaveBeenCalled();
  });

  it('matches the conflicting row regardless of email casing', async () => {
    getSignup.mockResolvedValue(signup({ email: 'KEVIN@DUMMY.TEST' }));
    listSignupsForSession.mockResolvedValue([
      signup({ email: 'KEVIN@DUMMY.TEST' }),
      signup({ signupId: 'new', status: 'waitlisted' }),
    ]);

    expect((await patch('old', { status: 'confirmed' })).status).toBe(409);
  });

  it('allows it when their other rows are all cancelled too', async () => {
    getSignup.mockResolvedValue(signup());
    listSignupsForSession.mockResolvedValue([
      signup(),
      signup({ signupId: 'older', status: 'cancelled' }),
    ]);

    const res = await patch('old', { status: 'confirmed' });

    expect(res.status).toBe(200);
    expect(updateSignup).toHaveBeenCalledWith('old', expect.objectContaining({ status: 'confirmed' }));
  });

  it('still lets an admin cancel a row, which is how a double-booking gets repaired', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));
    listSignupsForSession.mockResolvedValue([
      signup({ status: 'confirmed' }),
      signup({ signupId: 'new', status: 'confirmed' }),
    ]);

    const res = await patch('old', { status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(updateSignup).toHaveBeenCalledWith('old', expect.objectContaining({ status: 'cancelled' }));
  });

  it('does not block confirmed -> waitlisted on a roster that is already double-booked', async () => {
    // Repairing such a roster must not be harder than creating it was.
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));
    listSignupsForSession.mockResolvedValue([
      signup({ status: 'confirmed' }),
      signup({ signupId: 'new', status: 'confirmed' }),
    ]);

    expect((await patch('old', { status: 'waitlisted' })).status).toBe(200);
  });

  it('costs no extra Sheets read for a status move that cannot duplicate anyone', async () => {
    getSignup.mockResolvedValue(signup({ status: 'confirmed' }));

    await patch('old', { status: 'waitlisted' });

    expect(listSignupsForSession).not.toHaveBeenCalled();
  });

  it('reads this session once when a revive is checked and a payment is recorded together', async () => {
    getSignup.mockResolvedValue(signup());
    listSignupsForSession.mockResolvedValue([signup()]);
    getSession.mockResolvedValue({ sessionId: '2099-01-01', pricePerSpot: 10, cost: 0 });

    const res = await patch('old', { status: 'confirmed', paid: true });

    expect(res.status).toBe(200);
    expect(listSignupsForSession).toHaveBeenCalledTimes(1);
  });
});
