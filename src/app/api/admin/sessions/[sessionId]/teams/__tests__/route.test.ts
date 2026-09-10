import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../../../../../../lib/apiErrors';
import {
  createFakeStore,
  resetFakeStore,
  fakeSessionsModule,
  fakeSignupsModule,
  makeSession,
  makeSignup,
} from '../../../../../../../test/fakeSheets';

/**
 * The route had no test at all, which is how it came to hold the same leak the
 * projection boundary was built to close: `generate` returned the generator's
 * output, whose `members` are whole sheet rows wearing a five-field type.
 *
 * So the sheets layer is faked rather than the flow mocked — a test that stubs
 * `generateTeams` cannot see what `generateTeams` actually hands back.
 */

const requireAdmin = vi.fn();
vi.mock('../../../../../../../lib/auth', () => ({ requireAdmin }));

const store = createFakeStore();
vi.mock('../../../../../../../sheets/sessions', () => fakeSessionsModule(store));
vi.mock('../../../../../../../sheets/signups', () => fakeSignupsModule(store));

const { GET, POST } = await import('../route');

const SESSION = '2099-01-02';

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function post(body: unknown, sessionId = SESSION) {
  return POST(
    new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
    makeParams(sessionId)
  );
}

/** Every field a player's row carries that no browser has any business seeing. */
const SECRETS = {
  email: 'kevin@dummy.test',
  waiverText: 'I accept all risk of being hit by a softball.',
  amountPaid: 17.5,
  paidAt: '2099-01-01T00:00:00.000Z',
  subRequestTargetEmail: 'someone.else@dummy.test',
};

function seedConfirmed(overrides: Parameters<typeof makeSignup>[0] = {}) {
  const signup = makeSignup({
    signupId: 'kevin',
    sessionId: SESSION,
    status: 'confirmed',
    fullName: 'Kevin Kim',
    positions: 'Anything',
    ...SECRETS,
    ...overrides,
  });
  store.signups.set(signup.signupId, signup);
  return signup;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeStore(store);
  requireAdmin.mockResolvedValue('admin@dummy.test');
  store.sessions.set(SESSION, makeSession({ sessionId: SESSION, gameDate: SESSION, capacity: 20 }));
});

describe('POST /api/admin/sessions/[sessionId]/teams', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new ApiError(403, 'Admins only.'));
    expect((await post({ action: 'generate' })).status).toBe(403);
  });

  it('never sends a player row back when generating', async () => {
    seedConfirmed();

    const res = await post({ action: 'generate' });
    const body = await res.json();

    expect(res.status).toBe(200);
    for (const [field, value] of Object.entries(SECRETS)) {
      expect(JSON.stringify(body), `generate echoed ${field}`).not.toContain(String(value));
    }
  });

  it('still generates — the assignments land on the rows', async () => {
    seedConfirmed();

    const body = await (await post({ action: 'generate' })).json();

    expect(body.teamsStatus).toBe('draft');
    expect(store.signups.get('kevin')!.teamName).toMatch(/^Team \d+$/);
  });

  it('rejects a body that is neither an action nor assignments', async () => {
    expect((await post({})).status).toBe(400);
  });

  it('refuses to post teams that were never generated', async () => {
    expect((await post({ action: 'post' })).status).toBe(409);
  });

  it('posts generated teams', async () => {
    seedConfirmed();
    await post({ action: 'generate' });

    const body = await (await post({ action: 'post' })).json();

    expect(body.teamsStatus).toBe('posted');
  });

  it('saves an edited roster', async () => {
    seedConfirmed();

    const res = await post({ assignments: [{ signupId: 'kevin', teamName: 'Team 2' }] });

    expect(res.status).toBe(200);
    expect(store.signups.get('kevin')!.teamName).toBe('Team 2');
  });

  it('rejects an assignment for a signup from another session', async () => {
    seedConfirmed();
    expect((await post({ assignments: [{ signupId: 'stranger', teamName: 'Team 1' }] })).status).toBe(400);
  });

  it('rejects a malformed assignment', async () => {
    seedConfirmed();
    expect((await post({ assignments: [{ signupId: 'kevin' }] })).status).toBe(400);
  });

  it('404s for a session that does not exist', async () => {
    expect((await post({ action: 'generate' }, '2099-12-31')).status).toBe(404);
  });
});

describe('GET /api/admin/sessions/[sessionId]/teams', () => {
  it('never sends a player row back', async () => {
    seedConfirmed({ teamName: 'Team 1' });

    const body = await (await GET(new Request('http://x'), makeParams(SESSION))).json();

    expect(body.teams[0].members[0].fullName).toBe('Kevin Kim');
    for (const [field, value] of Object.entries(SECRETS)) {
      expect(JSON.stringify(body), `GET echoed ${field}`).not.toContain(String(value));
    }
  });

  it('404s for a session that does not exist', async () => {
    expect((await GET(new Request('http://x'), makeParams('2099-12-31'))).status).toBe(404);
  });
});
