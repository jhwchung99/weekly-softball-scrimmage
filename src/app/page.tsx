'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { POSITIONS } from '../lib/positions';

interface SessionInfo {
  sessionId: string;
  gameDate: string;
  gameTime: string;
  capacity: number;
  status: 'open' | 'closed' | 'cancelled';
}

interface SignupInfo {
  signupId: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  memberStatus: 'member' | 'guest';
  subRequestTargetEmail: string;
  subRequestStatus: '' | 'pending' | 'declined';
}

interface IncomingSubRequest {
  fromSignupId: string;
  fromFullName: string;
}

interface PlayerInfo {
  fullName: string;
  gender: string;
  age: number;
  savedPositions: string;
}

interface RosterEntry {
  fullName: string;
  positions: string;
  pairedWith: string | null;
}

interface Roster {
  confirmed: RosterEntry[];
  waitlisted: RosterEntry[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Request to ${url} failed`);
  return res.json();
}

export default function Home() {
  const { data: authSession, status: authStatus } = useSession();

  const [scrimmage, setScrimmage] = useState<SessionInfo | null>(null);
  const [scrimmageLoaded, setScrimmageLoaded] = useState(false);
  const [mySignup, setMySignup] = useState<SignupInfo | null>(null);
  const [incomingSubRequests, setIncomingSubRequests] = useState<IncomingSubRequest[]>([]);
  const [costOwed, setCostOwed] = useState<number | null>(null);
  const [myPlayer, setMyPlayer] = useState<PlayerInfo | null>(null);
  const [waiverText, setWaiverText] = useState('');
  const [roster, setRoster] = useState<Roster | null>(null);
  const [playerDataLoaded, setPlayerDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Public info: whether there's a scrimmage this week, regardless of login.
  useEffect(() => {
    fetchJson<{ session: SessionInfo | null }>('/api/sessions/current')
      .then((d) => setScrimmage(d.session))
      .catch((err) => setError(err.message))
      .finally(() => setScrimmageLoaded(true));
  }, []);

  async function loadPlayerData() {
    if (!scrimmage) return;
    setError(null);
    try {
      const [signupRes, playerRes, waiverRes, rosterRes] = await Promise.all([
        fetchJson<{ signup: SignupInfo | null; incomingSubRequests: IncomingSubRequest[]; costOwed: number | null }>(
          `/api/sessions/${scrimmage.sessionId}/signup`
        ),
        fetchJson<{ player: PlayerInfo | null }>('/api/players/me'),
        fetchJson<{ text: string }>('/api/waiver'),
        fetchJson<Roster>(`/api/sessions/${scrimmage.sessionId}/roster`),
      ]);
      setMySignup(signupRes.signup);
      setIncomingSubRequests(signupRes.incomingSubRequests);
      setCostOwed(signupRes.costOwed);
      setMyPlayer(playerRes.player);
      setWaiverText(waiverRes.text);
      setRoster(rosterRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlayerDataLoaded(true);
    }
  }

  useEffect(() => {
    if (authStatus === 'authenticated' && scrimmageLoaded && scrimmage) {
      // loadPlayerData is shared with the post-cancel/signup refresh calls
      // below, so it can't be inlined as a effect-local promise chain; its
      // setState calls only ever run after an await, same as any fetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPlayerData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, scrimmageLoaded, scrimmage?.sessionId]);

  async function handleCancel() {
    if (!mySignup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/signups/${mySignup.signupId}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Cancel failed');
      await loadPlayerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestSub(targetEmail: string) {
    if (!mySignup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/signups/${mySignup.signupId}/sub-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Request failed');
      await loadPlayerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSubRequest() {
    if (!mySignup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/signups/${mySignup.signupId}/sub-request`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Cancel failed');
      await loadPlayerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRespondToSubRequest(fromSignupId: string, accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/signups/${fromSignupId}/sub-request/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Response failed');
      await loadPlayerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Weekly Softball Scrimmage</h1>
      <p className="mt-2 text-slate-700">
        Weekly Softball Scrimmage is the signup app for New Hope Fellowship&apos;s weekly pickup softball game. Each
        week, members and their guests can sign up for a spot (first-come, first-served with an automatic waitlist),
        see whether they&apos;re confirmed or waitlisted, and cancel if plans change. Sign in with your Google account
        below to see this week&apos;s status and sign up.
      </p>
      <p className="mt-2 text-sm text-slate-500">
        Read our <a href="/privacy" className="text-blue-600 hover:underline">privacy policy</a> to see what
        information we collect and how it&apos;s used.
      </p>

      <div className="mt-4">
        {authStatus === 'loading' && <p className="text-slate-500">Loading...</p>}
        {authStatus === 'unauthenticated' && (
          <button
            onClick={() => signIn('google')}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Sign in with Google
          </button>
        )}
        {authStatus === 'authenticated' && (
          <div className="mt-1 flex items-center justify-between text-sm text-slate-600">
            <span>Signed in as {authSession?.user?.email}</span>
            <button onClick={() => signOut()} className="text-blue-600 hover:underline">
              Sign out
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="mt-6 rounded border border-slate-200 p-4">
        {!scrimmageLoaded && <p className="text-slate-500">Loading this week&apos;s scrimmage...</p>}
        {scrimmageLoaded && !scrimmage && (
          <p className="text-slate-600">No scrimmage scheduled yet for this week. Check back Monday morning.</p>
        )}
        {scrimmageLoaded && scrimmage && (
          <>
            <h2 className="font-semibold text-slate-900">
              Scrimmage — {scrimmage.gameDate} at {scrimmage.gameTime}
            </h2>
            {scrimmage.status === 'cancelled' && <p className="mt-1 text-red-700">This week&apos;s scrimmage has been cancelled.</p>}
            {scrimmage.status !== 'cancelled' && authStatus === 'authenticated' && (
              <PlayerArea
                scrimmage={scrimmage}
                registrationClosed={scrimmage.status === 'closed'}
                mySignup={mySignup}
                myPlayer={myPlayer}
                waiverText={waiverText}
                costOwed={costOwed}
                loaded={playerDataLoaded}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
                onCancel={handleCancel}
                onRefresh={loadPlayerData}
                onRequestSub={handleRequestSub}
                onCancelSubRequest={handleCancelSubRequest}
              />
            )}
            {scrimmage.status !== 'cancelled' && authStatus === 'unauthenticated' && (
              <p className="mt-2 text-slate-600">Sign in above to see your status or sign up.</p>
            )}
          </>
        )}
      </section>

      {authStatus === 'authenticated' && incomingSubRequests.length > 0 && (
        <section className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-slate-900">Sub requests for you</h2>
          <ul className="mt-2 space-y-2">
            {incomingSubRequests.map((r) => (
              <li key={r.fromSignupId} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                <span>{r.fromFullName} would like to sub with you.</span>
                <span className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => handleRespondToSubRequest(r.fromSignupId, true)}
                    className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => handleRespondToSubRequest(r.fromSignupId, false)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {authStatus === 'authenticated' && roster && (
        <section className="mt-4 rounded border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-900">Who&apos;s playing</h2>
          <div className="mt-2">
            <h3 className="text-sm font-medium text-slate-700">Confirmed ({roster.confirmed.length})</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              {roster.confirmed.map((p, i) => (
                <li key={i}>
                  {p.fullName}
                  {p.pairedWith ? ` & ${p.pairedWith} (sharing a spot)` : ''}
                </li>
              ))}
              {roster.confirmed.length === 0 && <li className="text-slate-400">No one confirmed yet.</li>}
            </ul>
          </div>
          <div className="mt-3">
            <h3 className="text-sm font-medium text-slate-700">Waitlist ({roster.waitlisted.length})</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              {roster.waitlisted.map((p, i) => (
                <li key={i}>
                  {i + 1}. {p.fullName}
                  {p.pairedWith ? ` & ${p.pairedWith} (sharing a spot)` : ''}
                </li>
              ))}
              {roster.waitlisted.length === 0 && <li className="text-slate-400">No one on the waitlist.</li>}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}

function PlayerArea(props: {
  scrimmage: SessionInfo;
  registrationClosed: boolean;
  mySignup: SignupInfo | null;
  myPlayer: PlayerInfo | null;
  waiverText: string;
  costOwed: number | null;
  loaded: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onCancel: () => void;
  onRefresh: () => void;
  onRequestSub: (targetEmail: string) => void;
  onCancelSubRequest: () => void;
}) {
  const {
    scrimmage,
    registrationClosed,
    mySignup,
    myPlayer,
    waiverText,
    costOwed,
    loaded,
    busy,
    setBusy,
    setError,
    onCancel,
    onRefresh,
    onRequestSub,
    onCancelSubRequest,
  } = props;

  if (!loaded) return <p className="mt-2 text-slate-500">Loading your status...</p>;

  if (mySignup) {
    return (
      <div className="mt-3">
        <p className="text-slate-800">
          You&apos;re{' '}
          <span className={mySignup.status === 'confirmed' ? 'font-semibold text-green-700' : 'font-semibold text-amber-700'}>
            {mySignup.status === 'confirmed' ? 'confirmed to play' : 'on the waitlist'}
          </span>
          {mySignup.memberStatus === 'guest' ? ' (as a guest)' : ''}
          {mySignup.status === 'confirmed' && costOwed !== null ? ` — your share: $${costOwed.toFixed(2)}` : ''}.
        </p>
        <button
          onClick={onCancel}
          disabled={busy}
          className="mt-3 rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Cancel my spot
        </button>

        {mySignup.status === 'waitlisted' && (
          <SubRequestPanel
            subRequestTargetEmail={mySignup.subRequestTargetEmail}
            subRequestStatus={mySignup.subRequestStatus}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onRequestSub={onRequestSub}
            onCancelSubRequest={onCancelSubRequest}
          />
        )}
      </div>
    );
  }

  if (registrationClosed) {
    return <p className="mt-2 text-slate-600">Registration is currently closed.</p>;
  }

  if (!myPlayer) {
    return (
      <ProfileForm
        onSaved={onRefresh}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
      />
    );
  }

  return (
    <SignupForm
      sessionId={scrimmage.sessionId}
      savedPositions={myPlayer.savedPositions}
      waiverText={waiverText}
      busy={busy}
      setBusy={setBusy}
      setError={setError}
      onSignedUp={onRefresh}
    />
  );
}

function SubRequestPanel(props: {
  subRequestTargetEmail: string;
  subRequestStatus: '' | 'pending' | 'declined';
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onRequestSub: (targetEmail: string) => void;
  onCancelSubRequest: () => void;
}) {
  const { subRequestTargetEmail, subRequestStatus, busy, onRequestSub, onCancelSubRequest } = props;
  const [targetEmail, setTargetEmail] = useState('');

  if (subRequestStatus === 'pending') {
    return (
      <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="text-slate-700">Waiting on {subRequestTargetEmail} to respond.</p>
        <button
          disabled={busy}
          onClick={onCancelSubRequest}
          className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
        >
          Cancel request
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      {subRequestStatus === 'declined' && (
        <p className="mb-2 text-slate-600">{subRequestTargetEmail} declined your last request.</p>
      )}
      <p className="text-xs text-slate-500">
        Know someone confirmed (or waitlisted) who might sub with you? Please try reaching out to them outside the
        app first, out of politeness, before sending a request below.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (targetEmail.trim()) onRequestSub(targetEmail.trim());
        }}
        className="mt-2 flex gap-2"
      >
        <input
          required
          type="email"
          placeholder="Their email"
          value={targetEmail}
          onChange={(e) => setTargetEmail(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-2 py-1"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Request to sub
        </button>
      </form>
    </div>
  );
}

function ProfileForm(props: {
  onSaved: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const { onSaved, busy, setBusy, setError } = props;
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [positions, setPositions] = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/players/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, gender, age: Number(age), savedPositions: positions.join(', ') }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not save profile');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function togglePosition(p: string) {
    setPositions((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <p className="text-sm text-slate-600">First time here — tell us a bit about yourself (saved for future weeks).</p>
      <div>
        <label className="block text-sm text-slate-700">Full name</label>
        <input
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm text-slate-700">Gender</label>
          <input
            required
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </div>
        <div className="w-24">
          <label className="block text-sm text-slate-700">Age</label>
          <input
            required
            type="number"
            min={0}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm text-slate-700">Positions you&apos;re comfortable playing</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {POSITIONS.map((p) => (
            <label key={p} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-sm">
              <input type="checkbox" checked={positions.includes(p)} onChange={() => togglePosition(p)} />
              {p}
            </label>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Save and continue
      </button>
    </form>
  );
}

function SignupForm(props: {
  sessionId: string;
  savedPositions: string;
  waiverText: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onSignedUp: () => void;
}) {
  const { sessionId, savedPositions, waiverText, busy, setBusy, setError, onSignedUp } = props;
  const [isGuest, setIsGuest] = useState(false);
  const [invitedByName, setInvitedByName] = useState('');
  const [willingToShare, setWillingToShare] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { waiverAccepted };
      if (isGuest) {
        body.invitedByName = invitedByName;
        body.willingToShare = willingToShare;
      }
      const res = await fetch(`/api/sessions/${sessionId}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Signup failed');
      onSignedUp();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <p className="text-sm text-slate-600">Your saved positions: {savedPositions || 'none saved yet'}</p>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isGuest} onChange={(e) => setIsGuest(e.target.checked)} />
        I&apos;m a guest (not a New Hope member)
      </label>

      {isGuest && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <div>
            <label className="block text-sm text-slate-700">Which member invited you?</label>
            <input
              required
              value={invitedByName}
              onChange={(e) => setInvitedByName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={willingToShare} onChange={(e) => setWillingToShare(e.target.checked)} />
            {"We're willing to share one roster slot between us"}
          </label>
        </div>
      )}

      <div className="rounded border border-slate-200 p-3 text-sm text-slate-600">{waiverText || 'Loading waiver...'}</div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={waiverAccepted} onChange={(e) => setWaiverAccepted(e.target.checked)} />
        I agree to the above
      </label>

      <button
        type="submit"
        disabled={busy || !waiverAccepted}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Sign up
      </button>
    </form>
  );
}
