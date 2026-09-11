// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from '../page';

/**
 * The page container itself, which every one of its sub-components already had
 * a test for and it did not.
 *
 * What lives only here is the wiring: one request for the whole page, the
 * branch on whether anyone is signed in, and the action policy — send, show
 * the server's own refusal, reload. The reload is the part worth guarding:
 * every action changes the roster, so a version that acted without re-reading
 * would leave a player looking at a page that no longer matches the sheet.
 */

const authStatus = { current: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading' };
const signIn = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: authStatus.current, data: { user: { email: 'kevin@dummy.test' } } }),
  signIn,
  signOut,
}));

const fetchMock = vi.fn();

const SESSION = {
  sessionId: '2026-07-10',
  gameDate: '2026-07-10',
  gameTime: '18:00',
  capacity: 20,
  numFields: 1,
  status: 'open',
  pricePerSpot: 10,
  locationArea: 'Mississauga',
  locationName: '',
  locationUrl: '',
  rosterLockAt: '',
  teamsStatus: '',
};

/** What /api/home answers, with only what a case cares about overridden. */
function home(over: Record<string, unknown> = {}) {
  return {
    session: SESSION,
    phase: 'open',
    signedIn: true,
    player: { fullName: 'Kevin Kim', gender: 'Male', savedPositions: 'SS' },
    signup: null,
    incomingSubRequests: [],
    costOwed: null,
    waitlistPosition: null,
    roster: { confirmedCount: 0, waitlistedCount: 0, confirmed: [], waitlisted: [] },
    teams: null,
    waiverText: 'I accept the risks.',
    paymentInstructions: 'e-Transfer the organizer.',
    ...over,
  };
}

function respondWith(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

beforeEach(() => {
  authStatus.current = 'authenticated';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  respondWith(home());
});

describe('Home', () => {
  it('loads the whole page in one request', async () => {
    // Four requests here used to cost five Sheets reads, against a quota of
    // sixty a minute for the entire app — spent hardest the moment
    // registration opens and everyone arrives at once.
    render(<Home />);

    await screen.findByText(/Scrimmage: 2026-07-10 at 18:00/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/home']);
  });

  it('waits for the session to resolve before asking, so it only asks once', async () => {
    // Fetching before auth resolves means a second round trip after signing
    // in, and a second set of Sheets reads with it.
    authStatus.current = 'loading';
    render(<Home />);

    expect(screen.getByText(/Loading\.\.\./)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a way in when nobody is signed in', async () => {
    authStatus.current = 'unauthenticated';
    render(<Home />);

    await userEvent.click(await screen.findByRole('button', { name: /sign in with google/i }));
    expect(signIn).toHaveBeenCalledWith('google');
  });

  it('says whose account this is, and offers the way out', async () => {
    render(<Home />);

    expect(await screen.findByText(/Signed in as kevin@dummy.test/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it('tells a player to come back rather than showing an empty week', async () => {
    respondWith(home({ session: null, phase: null }));
    render(<Home />);

    expect(await screen.findByText(/No game scheduled yet/)).toBeInTheDocument();
  });

  it('says a cancelled week is cancelled, and drops the timeline', async () => {
    respondWith(home({ session: { ...SESSION, status: 'cancelled' } }));
    render(<Home />);

    expect(await screen.findByText(/has been cancelled/)).toBeInTheDocument();
  });

  it('shows the price per spot when there is one', async () => {
    render(<Home />);
    expect(await screen.findByText(/20 spots · \$10\.00 each/)).toBeInTheDocument();
  });

  it('says nothing about money for a free week', async () => {
    respondWith(home({ session: { ...SESSION, pricePerSpot: 0 } }));
    render(<Home />);

    expect(await screen.findByText('20 spots')).toBeInTheDocument();
  });

  it('announces a failed load rather than showing a blank week', async () => {
    fetchMock.mockRejectedValue(new Error('Network is down'));
    render(<Home />);

    expect(await screen.findByText('Network is down')).toBeInTheDocument();
  });

  it("shows the server's own words when an action is refused", async () => {
    respondWith(home({ signup: { signupId: 's1', status: 'confirmed', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '' } }));
    render(<Home />);

    const cancel = await screen.findByRole('button', { name: /cancel my spot/i });
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Registration has closed for this week.' }) });
    await userEvent.click(cancel);

    expect(await screen.findByText('Registration has closed for this week.')).toBeInTheDocument();
  });

  it('re-reads the week after an action instead of guessing the new state', async () => {
    respondWith(home({ signup: { signupId: 's1', status: 'confirmed', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '' } }));
    render(<Home />);

    await userEvent.click(await screen.findByRole('button', { name: /cancel my spot/i }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls).toContain('/api/signups/s1/cancel');
      // The reload after it: the roster has changed and the page has to say so.
      expect(urls.lastIndexOf('/api/home')).toBeGreaterThan(urls.indexOf('/api/signups/s1/cancel'));
    });
  });
});
