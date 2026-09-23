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

/**
 * What /api/home answers, with only what a case cares about overridden.
 *
 * The response became a list of sessions on 2026-09-22. Cases still override
 * the per-session fields by their own names — `session`, `phase`, `roster` —
 * and this sorts them into the entry, so the twenty call sites below keep
 * saying what they mean. `session: null` means nothing is scheduled, which is
 * now an empty list rather than a null field.
 */
function home(over: Record<string, unknown> = {}) {
  const perSession = ['session', 'phase', 'signup', 'incomingSubRequests', 'costOwed', 'waitlistPosition', 'roster', 'teams'];
  const entry: Record<string, unknown> = {
    session: SESSION,
    phase: 'open',
    signup: null,
    incomingSubRequests: [],
    costOwed: null,
    waitlistPosition: null,
    roster: { confirmedCount: 0, waitlistedCount: 0, confirmed: [], waitlisted: [] },
    teams: null,
  };
  const top: Record<string, unknown> = {
    signedIn: true,
    player: { fullName: 'Kevin Kim', gender: 'Male', savedPositions: 'SS' },
    waiverText: 'I accept the risks.',
    paymentInstructions: 'e-Transfer the organizer.',
  };

  for (const [key, value] of Object.entries(over)) {
    if (perSession.includes(key)) entry[key] = value;
    else top[key] = value;
  }

  return { ...top, sessions: entry.session === null ? [] : [entry] };
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

    // A human date, not the ISO id: voice.md rule 2, and it matters more now
    // that a player may be choosing between two days.
    await screen.findByRole('button', { name: /Fri, Jul 10 · 6pm/ });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/home']);
  });

  it('shows both games in the same week, soonest first', async () => {
    // The whole point of the change: a Sunday game beside a Friday one used to
    // be invisible, because the lookup took the first of Fri/Sat/Sun and
    // stopped. Both are cards now rather than a thing to switch between.
    const sunday = { ...SESSION, sessionId: '2026-07-12', gameDate: '2026-07-12', gameTime: '14:00' };
    const base = home();
    respondWith({
      ...base,
      sessions: [base.sessions[0], { ...base.sessions[0], session: sunday }],
    });

    render(<Home />);

    const fridayRow = await screen.findByRole('button', { name: /Fri, Jul 10 · 6pm/ });
    const sundayRow = await screen.findByRole('button', { name: /Sun, Jul 12 · 2pm/ });

    // Only the soonest opens. The page shows every upcoming game, so leaving
    // them all expanded is most of a phone screen of scrolling before a player
    // reaches anything they can act on.
    expect(fridayRow).toHaveAttribute('aria-expanded', 'true');
    expect(sundayRow).toHaveAttribute('aria-expanded', 'false');

    // Still one request for the whole page, however many games it holds.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/home']);
  });

  it('opens a collapsed game when its row is tapped', async () => {
    const sunday = { ...SESSION, sessionId: '2026-07-12', gameDate: '2026-07-12', gameTime: '14:00' };
    const base = home();
    respondWith({ ...base, sessions: [base.sessions[0], { ...base.sessions[0], session: sunday }] });

    render(<Home />);
    const row = await screen.findByRole('button', { name: /Sun, Jul 12 · 2pm/ });

    await userEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    // Expanding reads what the page already has; it does not re-fetch.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/home']);
  });

  it('surfaces what a collapsed game still wants from you', async () => {
    // Collapsing is a change of layout, not of what reaches someone. The poll,
    // the payment prompt and a request to share a spot all live inside the
    // card, and a closed card would hide them behind a tap nobody knows to
    // take.
    const sunday = { ...SESSION, sessionId: '2026-07-12', gameDate: '2026-07-12', gameTime: '14:00', practicePollStatus: 'open' };
    const base = home();
    respondWith({
      ...base,
      sessions: [
        base.sessions[0],
        {
          ...base.sessions[0],
          session: sunday,
          signup: { signupId: 's2', status: 'confirmed', memberStatus: 'member', paid: false, subRequestStatus: '', subRequestTargetEmail: '', practicePollAnswer: '' },
          incomingSubRequests: [{ fromSignupId: 'x1', fromFullName: 'Sam Lee', fromGuestInvite: false }],
        },
      ],
    });

    render(<Home />);
    const row = await screen.findByRole('button', { name: /Sun, Jul 12 · 2pm/ });

    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveTextContent('1 request');
    expect(row).toHaveTextContent('poll');
  });

  // The panel shows waitlisted and cancelled players nothing, and the server
  // refuses their answers, so a badge pointed at a poll they could not see.
  it('flags the poll only for a confirmed player', async () => {
    const sunday = { ...SESSION, sessionId: '2026-07-12', gameDate: '2026-07-12', gameTime: '14:00', practicePollStatus: 'open' };
    const base = home();
    respondWith({
      ...base,
      sessions: [
        base.sessions[0],
        {
          ...base.sessions[0],
          session: sunday,
          signup: { signupId: 's2', status: 'waitlisted', memberStatus: 'member', paid: false, subRequestStatus: '', subRequestTargetEmail: '', practicePollAnswer: '' },
          incomingSubRequests: [],
        },
      ],
    });

    render(<Home />);
    const row = await screen.findByRole('button', { name: /Sun, Jul 12 · 2pm/ });

    expect(row).not.toHaveTextContent('poll');
  });

  it('stays quiet on a collapsed game that wants nothing', async () => {
    const sunday = { ...SESSION, sessionId: '2026-07-12', gameDate: '2026-07-12', gameTime: '14:00' };
    const base = home();
    respondWith({ ...base, sessions: [base.sessions[0], { ...base.sessions[0], session: sunday }] });

    render(<Home />);
    const row = await screen.findByRole('button', { name: /Sun, Jul 12 · 2pm/ });

    expect(row).not.toHaveTextContent('request');
    expect(row).not.toHaveTextContent('poll');
    expect(row).not.toHaveTextContent('payment due');
  });

  it('states the schedule as a sentence rather than a timeline', async () => {
    render(<Home />);
    await screen.findByRole('button', { name: /Fri, Jul 10 · 6pm/ });

    // Replaced a card of three dots. "midnight", not "12am": the close is
    // Tuesday 00:00 ET, which every player calls Monday night.
    expect(screen.getByText(/Sign-ups close Monday, July 6 at midnight/)).toBeInTheDocument();
    expect(screen.queryByText(/12am/)).not.toBeInTheDocument();
  });

  it('labels the groups only when there is more than one game', async () => {
    render(<Home />);
    await screen.findByRole('button', { name: /Fri, Jul 10 · 6pm/ });

    // A single game needs no "This week" heading above it.
    expect(screen.queryByText(/^This week$/)).not.toBeInTheDocument();
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
