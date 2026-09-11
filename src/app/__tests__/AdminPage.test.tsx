// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from '../admin/page';

/**
 * The console container, at 37% the least-covered file in the app. Its forms
 * and tables each had a test; the thing holding them together did not.
 *
 * What lives only here: finding this week without being told, loading the
 * session and its roster together, telling "you are not an admin" apart from
 * "that week does not exist", and following a rescheduled session to its new
 * id — a session's id *is* its game date, so a reschedule rekeys the row and a
 * console that does not follow it acts on a week that no longer exists.
 */

const authStatus = { current: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading' };
const signIn = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: authStatus.current, data: { user: { email: 'organizer@dummy.test' } } }),
  signIn,
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const fetchMock = vi.fn();

const SESSION = {
  sessionId: '2026-07-10',
  gameDate: '2026-07-10',
  gameTime: '18:00',
  capacity: 20,
  numFields: 1,
  status: 'open',
  cost: 100,
  pricePerSpot: 10,
  locationArea: 'Mississauga',
  locationName: '',
  locationUrl: '',
  teamsStatus: '',
};

const SIGNUP = {
  signupId: 's1',
  email: 'kevin@dummy.test',
  fullName: 'Kevin Kim',
  memberStatus: 'member',
  invitedByName: '',
  pairId: '',
  status: 'confirmed',
  positions: 'SS',
  paid: false,
  amountPaid: 0,
  attended: false,
};

type Reply = { ok: boolean; body: unknown; status?: number };

/** Answers each URL the console asks for, so a case only names what it changes. */
function routes(over: Record<string, () => Reply> = {}) {
  const table: Record<string, () => Reply> = {
    '/api/sessions/current': () => ({ ok: true, body: { session: SESSION } }),
    '/api/admin/sessions/2026-07-10': () => ({ ok: true, body: { session: SESSION } }),
    '/api/admin/sessions/2026-07-10/signups': () => ({ ok: true, body: { signups: [SIGNUP] } }),
    '/api/admin/sessions/2026-07-10/teams': () => ({ ok: true, body: { teams: [], teamsStatus: '', numFields: 1 } }),
    ...over,
  };
  fetchMock.mockImplementation(async (url: string) => {
    const handler = table[url] ?? ((): Reply => ({ ok: true, body: {} }));
    const { ok, body, status } = handler();
    return { ok, status: status ?? (ok ? 200 : 500), json: async () => body };
  });
}

beforeEach(() => {
  authStatus.current = 'authenticated';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  routes();
});

describe('AdminPage', () => {
  it('finds this week without being told which one it is', async () => {
    render(<AdminPage />);

    expect(await screen.findByDisplayValue('2026-07-10')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/sessions/current');
  });

  it('loads the session and its roster together, not one after the other', async () => {
    // Two sequential round trips is two chances for the console to sit blank
    // while the second one runs.
    render(<AdminPage />);

    await screen.findByText('Kevin Kim');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['/api/admin/sessions/2026-07-10', '/api/admin/sessions/2026-07-10/signups'])
    );
  });

  it('says plainly when the signed-in account is not an admin', async () => {
    // 403 is not an error to show a stack trace for: it means this person is
    // signed in fine and simply is not on the list.
    routes({ '/api/admin/sessions/2026-07-10': () => ({ ok: false, status: 403, body: { error: 'Admins only.' } }) });
    render(<AdminPage />);

    expect(await screen.findByText(/organizer@dummy\.test is not on the Admins list/)).toBeInTheDocument();
  });

  it('hides the console entirely from a non-admin, rather than showing empty controls', async () => {
    routes({ '/api/admin/sessions/2026-07-10': () => ({ ok: false, status: 403, body: {} }) });
    render(<AdminPage />);

    await screen.findByText(/not on the Admins list/);
    expect(screen.queryByLabelText(/Session \(defaults/)).not.toBeInTheDocument();
  });

  it('tells a missing week apart from a refused one', async () => {
    routes({ '/api/admin/sessions/2026-07-10': () => ({ ok: false, status: 404, body: {} }) });
    render(<AdminPage />);

    expect(await screen.findByText('No session "2026-07-10" exists yet.')).toBeInTheDocument();
    // Still an admin, so the controls stay.
    expect(screen.getByLabelText(/Session \(defaults/)).toBeInTheDocument();
  });

  it('reloads when the organizer looks at a different week', async () => {
    render(<AdminPage />);
    await screen.findByText('Kevin Kim');

    const input = await screen.findByLabelText(/Session \(defaults/);
    await userEvent.clear(input);
    await userEvent.type(input, '2026-07-17');

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/admin/sessions/2026-07-17');
    });
  });

  it('offers a way in when nobody is signed in, and asks for nothing first', async () => {
    authStatus.current = 'unauthenticated';
    render(<AdminPage />);

    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }));
    expect(signIn).toHaveBeenCalledWith('google');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the session to resolve before asking', async () => {
    authStatus.current = 'loading';
    render(<AdminPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a rescheduled session to its new id', async () => {
    // The id *is* the game date, so a reschedule rekeys the row. A console
    // that keeps the old id acts on a week that no longer exists, and nothing
    // says so until the next edit fails.
    render(<AdminPage />);
    await screen.findByText('Kevin Kim');

    routes({
      '/api/admin/sessions/2026-07-10': () => ({
        ok: true,
        body: { session: { ...SESSION, sessionId: '2026-07-11', gameDate: '2026-07-11' } },
      }),
      '/api/admin/sessions/2026-07-11': () => ({
        ok: true,
        body: { session: { ...SESSION, sessionId: '2026-07-11', gameDate: '2026-07-11' } },
      }),
      '/api/admin/sessions/2026-07-11/signups': () => ({ ok: true, body: { signups: [SIGNUP] } }),
    });

    await userEvent.click(screen.getByRole('button', { name: /reschedule/i }));

    await waitFor(() => expect(screen.getByLabelText(/Session \(defaults/)).toHaveValue('2026-07-11'));
  });

  /**
   * Every path from this page that puts mail in a player's inbox has to ask
   * first. An email cannot be recalled, the audience is everyone signed up,
   * and the buttons sit beside harmless Save buttons — so one misclick must
   * never be enough.
   *
   * Written as a rule over the page rather than per button, so a fifth send
   * added later without a confirm fails this instead of shipping.
   */
  describe('nothing mails players on one click', () => {
    /** The session's capacity box and its Save, not the create-session form's
     * identically-labelled pair. */
    function capacityControls() {
      const input = document.getElementById('admin-capacity') as HTMLInputElement;
      // The capacity Save and the fields Save share a row; capacity's comes
      // first, immediately after its input.
      const save = within(input.closest('div') as HTMLElement).getAllByRole('button', { name: /Save|Processing/ })[0];
      return { input, save };
    }

    async function clickAndCount(name: RegExp) {
      const confirmMock = vi.fn(() => false); // the organizer says no
      vi.stubGlobal('confirm', confirmMock);
      render(<AdminPage />);
      await screen.findByText('Kevin Kim');

      const button = await screen.findByRole('button', { name });
      const before = fetchMock.mock.calls.length;
      fireEvent.click(button);

      return { confirmMock, sentAnything: fetchMock.mock.calls.length > before };
    }

    it('asks before notifying players, and sends nothing when refused', async () => {
      const { confirmMock, sentAnything } = await clickAndCount(/Notify \d+ player/);

      expect(confirmMock).toHaveBeenCalled();
      expect(sentAnything).toBe(false);
    });

    it('asks before a capacity raise, which promotes and emails off the waitlist', async () => {
      routes({
        '/api/admin/sessions/2026-07-10/signups': () => ({
          ok: true,
          body: { signups: [SIGNUP, { ...SIGNUP, signupId: 's2', email: 'w@dummy.test', fullName: 'Waiting W', status: 'waitlisted' }] },
        }),
      });
      const confirmMock = vi.fn(() => false);
      vi.stubGlobal('confirm', confirmMock);
      render(<AdminPage />);
      await screen.findByText('Waiting W');

      const { input, save } = capacityControls();
      fireEvent.change(input, { target: { value: '30' } });
      const before = fetchMock.mock.calls.length;
      fireEvent.click(save);

      expect(confirmMock).toHaveBeenCalledWith(expect.stringMatching(/promote 1 waitlisted spot and email them/));
      expect(fetchMock.mock.calls.length).toBe(before);
    });

    it('does not ask when a capacity change emails nobody', async () => {
      // Nobody waiting: the save is ordinary admin, and a pointless dialog
      // teaches the organizer to click through dialogs.
      const confirmMock = vi.fn(() => true);
      vi.stubGlobal('confirm', confirmMock);
      render(<AdminPage />);
      await screen.findByText('Kevin Kim');

      const { input, save } = capacityControls();
      fireEvent.change(input, { target: { value: '30' } });
      fireEvent.click(save);

      expect(confirmMock).not.toHaveBeenCalled();
    });
  });
});
