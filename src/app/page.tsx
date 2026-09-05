'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Loader2, Users, CheckCircle2, Clock3, ListChecks, ShieldCheck, Lock } from 'lucide-react';
import { POSITIONS } from '../lib/positions';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { WeeklyTimeline } from '../components/WeeklyTimeline';
import { getWeeklyMilestones } from '../lib/time';
import { SessionLocation } from '../components/SessionLocation';
import { AddToCalendar } from '../components/AddToCalendar';

export interface SessionInfo {
  sessionId: string;
  gameDate: string;
  gameTime: string;
  capacity: number;
  status: 'open' | 'closed' | 'cancelled';
  pricePerSpot: number;
  locationArea: string;
  locationName: string;
  locationUrl: string;
}

export interface SignupInfo {
  signupId: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  memberStatus: 'member' | 'guest';
  subRequestTargetEmail: string;
  subRequestStatus: '' | 'pending' | 'declined';
}

export interface IncomingSubRequest {
  fromSignupId: string;
  fromFullName: string;
}

export interface PlayerInfo {
  fullName: string;
  gender: string;
  savedPositions: string;
}

export interface RosterEntry {
  fullName: string;
  positions: string;
  pairedWith: string | null;
}

export interface Roster {
  confirmedCount: number;
  waitlistedCount: number;
  /** Null when the viewer hasn't signed up for this session — counts are
   * still shown, names are not. See the roster route for why. */
  confirmed: RosterEntry[] | null;
  waitlisted: RosterEntry[] | null;
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
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [myPlayer, setMyPlayer] = useState<PlayerInfo | null>(null);
  const [waiverText, setWaiverText] = useState('');
  // How to actually pay. Comes from the server rather than the bundle so the
  // organizer's payment address isn't published to anyone who loads the page.
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [roster, setRoster] = useState<Roster | null>(null);
  const [playerDataLoaded, setPlayerDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * One request for the whole page. This used to be four (session, my status,
   * profile, roster), which cost 5 Sheets reads because two tabs were each read
   * twice — and the app's entire Sheets quota is 60 reads/minute across all
   * users, hit hardest exactly when registration opens and everyone arrives at
   * once. See the /api/home route for the full reasoning.
   */
  async function loadHome() {
    setError(null);
    try {
      const d = await fetchJson<{
        session: SessionInfo | null;
        signedIn: boolean;
        player: PlayerInfo | null;
        signup: SignupInfo | null;
        incomingSubRequests: IncomingSubRequest[];
        costOwed: number | null;
        waitlistPosition: number | null;
        roster: Roster | null;
        waiverText: string;
        paymentInstructions: string;
      }>('/api/home');

      setScrimmage(d.session);
      setMySignup(d.signup);
      setIncomingSubRequests(d.incomingSubRequests);
      setCostOwed(d.costOwed);
      setWaitlistPosition(d.waitlistPosition);
      setMyPlayer(d.player);
      setWaiverText(d.waiverText);
      setPaymentInstructions(d.paymentInstructions);
      setRoster(d.roster);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScrimmageLoaded(true);
      // Only meaningful once signed in, but harmless to set either way — the
      // sections that read it are already gated on authStatus.
      setPlayerDataLoaded(true);
    }
  }

  // Waits for authStatus so the request is made once, with the session cookie
  // attached — fetching before it resolves would mean a second, redundant call
  // (and a second set of Sheets reads) after signing in.
  useEffect(() => {
    if (authStatus === 'loading') return;
    // loadHome is shared with the post-signup/cancel refresh calls below, so it
    // can't be inlined as an effect-local promise chain; its setState calls
    // only ever run after an await, same as any fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHome();
  }, [authStatus]);

  async function handleCancel() {
    if (!mySignup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/signups/${encodeURIComponent(mySignup.signupId)}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Cancel failed');
      await loadHome();
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
      const res = await fetch(`/api/signups/${encodeURIComponent(mySignup.signupId)}/sub-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Request failed');
      await loadHome();
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
      const res = await fetch(`/api/signups/${encodeURIComponent(mySignup.signupId)}/sub-request`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Cancel failed');
      await loadHome();
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
      const res = await fetch(`/api/signups/${encodeURIComponent(fromSignupId)}/sub-request/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Response failed');
      await loadHome();
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
        Read our <a href="/privacy" className="text-blue-600 hover:underline">privacy policy</a> or see the{' '}
        <a href="/guidelines" className="text-blue-600 hover:underline">full guidelines</a> for how signups, guests,
        and cancellations work.
      </p>

      <Card className="mt-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ListChecks className="h-4 w-4" /> Quick guide
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>First-come, first-served — extra signups go to an automatic waitlist.</li>
          <li>Cancel any time, but cancellations within 5 hours of game time won&apos;t trigger an auto-replacement.</li>
          <li>Bringing a guest? They can optionally share your spot instead of taking a separate one.</li>
          <li>Once the week is priced, cost splits evenly across confirmed spots.</li>
        </ul>
        <a href="/guidelines" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          Full guidelines →
        </a>
      </Card>

      <div className="mt-4">
        {authStatus === 'loading' && (
          <p className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </p>
        )}
        {authStatus === 'unauthenticated' && (
          <>
            <Button onClick={() => signIn('google')} className="mt-4">
              Sign in with Google
            </Button>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              We only see your name and email — never your password, inbox, or anything else in your Google account.
            </p>
          </>
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

      {authStatus === 'authenticated' && playerDataLoaded && myPlayer && (
        <ProfileSection
          myPlayer={myPlayer}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onSaved={loadHome}
        />
      )}

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Card className="mt-6">
        {!scrimmageLoaded && (
          <p className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading this week&apos;s scrimmage...
          </p>
        )}
        {scrimmageLoaded && !scrimmage && (
          <p className="text-slate-600">No scrimmage scheduled yet for this week. Check back Monday morning.</p>
        )}
        {scrimmageLoaded && scrimmage && (
          <>
            <h2 className="font-semibold text-slate-900">
              Scrimmage — {scrimmage.gameDate} at {scrimmage.gameTime}
            </h2>
            <SessionLocation
              className="mt-1"
              locationArea={scrimmage.locationArea}
              locationName={scrimmage.locationName}
              locationUrl={scrimmage.locationUrl}
            />
            {scrimmage.pricePerSpot > 0 && (
              <p className="mt-1 text-sm text-slate-600">${scrimmage.pricePerSpot.toFixed(2)} per spot</p>
            )}
            {scrimmage.status === 'cancelled' && <p className="mt-1 text-red-700">This week&apos;s scrimmage has been cancelled.</p>}
            {scrimmage.status !== 'cancelled' && (
              <WeeklyTimeline gameDate={scrimmage.gameDate} gameTime={scrimmage.gameTime} status={scrimmage.status} />
            )}
            {scrimmage.status !== 'cancelled' && authStatus === 'authenticated' && (
              <PlayerArea
                scrimmage={scrimmage}
                registrationClosed={scrimmage.status === 'closed'}
                mySignup={mySignup}
                myPlayer={myPlayer}
                waiverText={waiverText}
                costOwed={costOwed}
                waitlistPosition={waitlistPosition}
                paymentInstructions={paymentInstructions}
                loaded={playerDataLoaded}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
                onCancel={handleCancel}
                onRefresh={loadHome}
                onRequestSub={handleRequestSub}
                onCancelSubRequest={handleCancelSubRequest}
              />
            )}
            {scrimmage.status !== 'cancelled' && authStatus === 'unauthenticated' && (
              <p className="mt-2 text-slate-600">Sign in above to see your status or sign up.</p>
            )}
          </>
        )}
      </Card>

      {authStatus === 'authenticated' && incomingSubRequests.length > 0 && (
        <Card className="mt-4 border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-slate-900">Sub requests for you</h2>
          {busy && <p className="mt-1 text-xs text-slate-500">Processing...</p>}
          <ul className="mt-2 space-y-2">
            {incomingSubRequests.map((r) => (
              <li key={r.fromSignupId} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                <span>{r.fromFullName} would like to sub with you.</span>
                <span className="flex gap-2">
                  <Button
                    variant="success"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleRespondToSubRequest(r.fromSignupId, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleRespondToSubRequest(r.fromSignupId, false)}
                  >
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {authStatus === 'authenticated' && roster && (
        <Card className="mt-4">
          <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
            <Users className="h-4 w-4" /> Who&apos;s playing
          </h2>
          <div className="mt-2">
            <h3 className="flex items-center gap-1 text-sm font-medium text-slate-700">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Confirmed ({roster.confirmedCount})
            </h3>
            {roster.confirmed && (
              <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                {roster.confirmed.map((p, i) => (
                  <li key={i}>
                    {p.fullName}
                    {p.pairedWith ? ` & ${p.pairedWith} (sharing a spot)` : ''}
                  </li>
                ))}
                {roster.confirmed.length === 0 && <li className="text-slate-400">No one confirmed yet.</li>}
              </ul>
            )}
          </div>
          <div className="mt-3">
            <h3 className="flex items-center gap-1 text-sm font-medium text-slate-700">
              <Clock3 className="h-3.5 w-3.5 text-amber-600" /> Waitlist ({roster.waitlistedCount})
            </h3>
            {roster.waitlisted && (
              <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                {roster.waitlisted.map((p, i) => (
                  <li key={i}>
                    {i + 1}. {p.fullName}
                    {p.pairedWith ? ` & ${p.pairedWith} (sharing a spot)` : ''}
                  </li>
                ))}
                {roster.waitlisted.length === 0 && <li className="text-slate-400">No one on the waitlist.</li>}
              </ul>
            )}
          </div>
          {!roster.confirmed && (
            <p className="mt-3 flex items-start gap-1.5 border-t border-slate-100 pt-3 text-sm text-slate-500">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              To view the roster, please sign up.
            </p>
          )}
        </Card>
      )}
    </main>
  );
}

/**
 * What a confirmed player owes, and when it becomes payable.
 *
 * Payment deliberately does not open until the roster locks — 5 hours before
 * game time, the same moment cancellations stop auto-promoting anyone. Before
 * that the lineup can still change, so charging early would create cases where
 * somebody has paid and is then replaced, leaving the organizer to work out
 * who owes whom. Aligning the two timelines means that case cannot arise: no
 * refunds, no transfers between players, nothing to reconcile.
 */
function PaymentPrompt({
  amount,
  gameDate,
  gameTime,
  instructions,
}: {
  amount: number;
  gameDate: string;
  gameTime: string;
  instructions: string;
}) {
  const { cutoffStart } = getWeeklyMilestones(gameDate, gameTime);
  const opensAt = cutoffStart.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (new Date() < cutoffStart) {
    return (
      <p className="mt-2 text-sm text-slate-500">
        Your spot costs <strong>${amount.toFixed(2)}</strong>. Nothing to pay yet — payment opens {opensAt}, once the
        roster is locked and the lineup can no longer change.
      </p>
    );
  }

  return (
    <p className="mt-2 text-sm text-slate-700">
      You owe <strong>${amount.toFixed(2)}</strong> — please send it before the game starts.
      {instructions ? ` ${instructions}` : ''}
    </p>
  );
}

export function PlayerArea(props: {
  scrimmage: SessionInfo;
  registrationClosed: boolean;
  mySignup: SignupInfo | null;
  myPlayer: PlayerInfo | null;
  waiverText: string;
  costOwed: number | null;
  waitlistPosition: number | null;
  paymentInstructions: string;
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
    waitlistPosition,
    paymentInstructions,
    loaded,
    busy,
    setBusy,
    setError,
    onCancel,
    onRefresh,
    onRequestSub,
    onCancelSubRequest,
  } = props;

  if (!loaded) {
    return (
      <p className="mt-2 flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your status...
      </p>
    );
  }

  if (mySignup) {
    return (
      <div className="mt-3">
        <p className="flex flex-wrap items-center gap-2 text-slate-800">
          You&apos;re <Badge status={mySignup.status === 'confirmed' ? 'confirmed' : 'waitlisted'}>
            {mySignup.status === 'confirmed' ? 'confirmed to play' : 'on the waitlist'}
          </Badge>
          {mySignup.memberStatus === 'guest' ? '(as a guest)' : ''}
          {mySignup.status === 'waitlisted' && waitlistPosition !== null ? `— #${waitlistPosition} in line` : ''}
        </p>

        {mySignup.status === 'confirmed' && costOwed !== null && (
          <PaymentPrompt
            amount={costOwed}
            gameDate={scrimmage.gameDate}
            gameTime={scrimmage.gameTime}
            instructions={paymentInstructions}
          />
        )}

        {mySignup.status === 'confirmed' && (
          <AddToCalendar
            gameDate={scrimmage.gameDate}
            gameTime={scrimmage.gameTime}
            locationArea={scrimmage.locationArea}
            locationName={scrimmage.locationName}
            locationUrl={scrimmage.locationUrl}
          />
        )}

        <Button variant="danger" size="md" onClick={onCancel} disabled={busy} className="mt-3">
          {busy ? 'Processing...' : 'Cancel my spot'}
        </Button>

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

export function SubRequestPanel(props: {
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
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="text-slate-700">Waiting on {subRequestTargetEmail} to respond.</p>
        <Button variant="secondary" size="sm" disabled={busy} onClick={onCancelSubRequest} className="mt-2">
          {busy ? 'Processing...' : 'Cancel request'}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      {subRequestStatus === 'declined' && (
        <p className="mb-2 text-slate-600">{subRequestTargetEmail} declined your last request.</p>
      )}
      <p className="text-xs text-slate-500">
        Please reach out outside the app first, out of politeness — see the{' '}
        <a href="/guidelines" className="text-blue-600 hover:underline">
          full guidelines
        </a>
        .
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
          aria-label="Their email"
          placeholder="Their email"
          value={targetEmail}
          onChange={(e) => setTargetEmail(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-2 py-1"
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Processing...' : 'Request to sub'}
        </Button>
      </form>
    </div>
  );
}

export function ProfileSection(props: {
  myPlayer: PlayerInfo;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onSaved: () => void;
}) {
  const { myPlayer, busy, setBusy, setError, onSaved } = props;
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card className="mt-4">
        <ProfileForm
          initialValues={myPlayer}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-700">
      <span>
        {myPlayer.fullName} — {myPlayer.gender} — positions: {myPlayer.savedPositions || 'none saved'}
      </span>
      <button onClick={() => setEditing(true)} className="shrink-0 text-blue-600 hover:underline">
        Edit profile
      </button>
    </Card>
  );
}

export function ProfileForm(props: {
  initialValues?: PlayerInfo;
  onSaved: () => void;
  onCancel?: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const { initialValues, onSaved, onCancel, busy, setBusy, setError } = props;
  const [fullName, setFullName] = useState(initialValues?.fullName ?? '');
  const [gender, setGender] = useState(initialValues?.gender ?? '');
  const [positions, setPositions] = useState<string[]>(
    initialValues?.savedPositions
      ? initialValues.savedPositions
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : []
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/players/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, gender, savedPositions: positions.join(', ') }),
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
      <p className="text-sm text-slate-600">
        {initialValues
          ? "Update your info — this won't change a signup you've already submitted for this week, only future ones."
          : 'First time here — tell us a bit about yourself (saved for future weeks).'}
      </p>
      <div>
        <label htmlFor="profile-full-name" className="block text-sm text-slate-700">Full name</label>
        <input
          id="profile-full-name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <div>
        <label htmlFor="profile-gender" className="block text-sm text-slate-700">Gender</label>
        <input
          id="profile-gender"
          required
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
        />
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
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Processing...' : initialValues ? 'Save changes' : 'Save and continue'}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function SignupForm(props: {
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
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/signup`, {
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
            <label htmlFor="signup-invited-by" className="block text-sm text-slate-700">Which member invited you?</label>
            <input
              id="signup-invited-by"
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

      <Button type="submit" disabled={busy || !waiverAccepted}>
        {busy ? 'Processing...' : 'Sign up'}
      </Button>
    </form>
  );
}
