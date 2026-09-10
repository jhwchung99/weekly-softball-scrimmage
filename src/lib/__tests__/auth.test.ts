import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The gate itself, which nothing tested.
 *
 * `requireAdmin` is the only thing between a signed-in stranger and the
 * organizer's console, and every route test replaces it with a `vi.fn()`. What
 * those assert is that *the route calls the gate* — never that *the gate
 * works*. Sixteen call sites mocking a promise nobody exercised is the same
 * shape as the notification guard before it was fixed.
 *
 * `isAdminEmail` has its own tests over the Admins tab. What is checked here is
 * the composition: which failure produces which status, and that identity is
 * normalized before the allowlist is consulted.
 */

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('next-auth/providers/google', () => ({ default: () => ({ id: 'google' }) }));

const isAdminEmail = vi.fn();
vi.mock('../../sheets/admins', () => ({ isAdminEmail }));

const { getSessionEmail, getSessionUser, requireSignedIn, requireAdmin } = await import('../auth');

/** A next-auth session for someone signed in as `email`. */
const signedInAs = (email: string, name?: string) => ({ user: { email, name } });

beforeEach(() => {
  vi.clearAllMocks();
  isAdminEmail.mockResolvedValue(false);
});

describe('getSessionEmail', () => {
  it('is null when nobody is signed in', async () => {
    getServerSession.mockResolvedValue(null);

    expect(await getSessionEmail()).toBeNull();
  });

  it('is null for a session carrying no email', async () => {
    getServerSession.mockResolvedValue({ user: {} });

    expect(await getSessionEmail()).toBeNull();
  });

  it('normalizes the address, because everything downstream compares against it', async () => {
    // The single choke point: nothing downstream should have to remember to
    // lowercase, and a stored row typed by hand may not match otherwise.
    getServerSession.mockResolvedValue(signedInAs('Kevin@Dummy.TEST'));

    expect(await getSessionEmail()).toBe('kevin@dummy.test');
  });
});

describe('getSessionUser', () => {
  it('carries the display name Google supplied', async () => {
    getServerSession.mockResolvedValue(signedInAs('kevin@dummy.test', 'Kevin Kim'));

    expect(await getSessionUser()).toEqual({ email: 'kevin@dummy.test', name: 'Kevin Kim' });
  });

  it('gives an empty name rather than undefined when Google supplied none', async () => {
    getServerSession.mockResolvedValue(signedInAs('kevin@dummy.test'));

    expect(await getSessionUser()).toEqual({ email: 'kevin@dummy.test', name: '' });
  });

  it('is null when nobody is signed in', async () => {
    getServerSession.mockResolvedValue(null);

    expect(await getSessionUser()).toBeNull();
  });
});

describe('requireSignedIn', () => {
  it('returns the normalized email of whoever is signed in', async () => {
    getServerSession.mockResolvedValue(signedInAs('Kevin@Dummy.TEST'));

    expect(await requireSignedIn()).toBe('kevin@dummy.test');
  });

  it('refuses with 401 when nobody is', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(requireSignedIn()).rejects.toMatchObject({ status: 401, message: 'Not signed in.' });
  });
});

describe('requireAdmin', () => {
  it('lets an organizer through, and returns their email', async () => {
    getServerSession.mockResolvedValue(signedInAs('admin@dummy.test'));
    isAdminEmail.mockResolvedValue(true);

    expect(await requireAdmin()).toBe('admin@dummy.test');
  });

  it('refuses a signed-out caller with 401, not 403', async () => {
    // The console renders these as two different screens: 401 is "sign in",
    // 403 is "you are not an admin". Collapsing them would tell a signed-out
    // organizer they lack permission they actually have.
    getServerSession.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
    expect(isAdminEmail).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin with 403, naming them', async () => {
    getServerSession.mockResolvedValue(signedInAs('player@dummy.test'));
    isAdminEmail.mockResolvedValue(false);

    await expect(requireAdmin()).rejects.toMatchObject({
      status: 403,
      message: '"player@dummy.test" is not an admin.',
    });
  });

  it('checks the allowlist against the normalized address', async () => {
    // An organizer whose Google account reports mixed casing must still match
    // a row on the Admins tab — this is why identity is normalized at the
    // session rather than at each comparison.
    getServerSession.mockResolvedValue(signedInAs('Admin@Dummy.TEST'));
    isAdminEmail.mockResolvedValue(true);

    await requireAdmin();

    expect(isAdminEmail).toHaveBeenCalledWith('admin@dummy.test');
  });

  it('does not let a rejected allowlist read pass as authorised', async () => {
    getServerSession.mockResolvedValue(signedInAs('admin@dummy.test'));
    isAdminEmail.mockRejectedValue(new Error('Sheets is down'));

    await expect(requireAdmin()).rejects.toThrow('Sheets is down');
  });
});
