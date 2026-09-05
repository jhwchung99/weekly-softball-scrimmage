'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import { BookOpen } from 'lucide-react';
import { POSITIONS } from '../../lib/positions';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';

type SignupStatus = 'confirmed' | 'waitlisted' | 'cancelled';
type SessionStatus = 'open' | 'closed' | 'cancelled';

interface SessionInfo {
  sessionId: string;
  gameDate: string;
  gameTime: string;
  capacity: number;
  status: SessionStatus;
  cost: number;
}

interface AdminSignup {
  signupId: string;
  email: string;
  fullName: string;
  memberStatus: 'member' | 'guest';
  invitedByName: string;
  pairId: string;
  status: SignupStatus;
  positions: string;
  paid: boolean;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new HttpError(res.status, body?.error || `Request to ${url} failed`);
  }
  return res.json();
}

export default function AdminPage() {
  const { data: authSession, status: authStatus } = useSession();

  const [sessionId, setSessionId] = useState('');
  const [scrimmage, setScrimmage] = useState<SessionInfo | null>(null);
  const [roster, setRoster] = useState<AdminSignup[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capacityInput, setCapacityInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [gameDateInput, setGameDateInput] = useState('');
  const [gameTimeInput, setGameTimeInput] = useState('');

  async function loadCurrentSessionId() {
    const { session } = await fetchJson<{ session: SessionInfo | null }>('/api/sessions/current');
    if (session) setSessionId(session.sessionId);
  }

  async function loadRoster(id: string) {
    if (!id) return;
    setError(null);
    setForbidden(false);
    setScrimmage(null);
    try {
      const [sessionRes, rosterRes] = await Promise.all([
        fetchJson<{ session: SessionInfo }>(`/api/admin/sessions/${id}`),
        fetchJson<{ signups: AdminSignup[] }>(`/api/admin/sessions/${id}/signups`),
      ]);
      setScrimmage(sessionRes.session);
      setCapacityInput(String(sessionRes.session.capacity));
      setCostInput(String(sessionRes.session.cost));
      setGameDateInput(sessionRes.session.gameDate);
      setGameTimeInput(sessionRes.session.gameTime);
      setRoster(rosterRes.signups);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        setForbidden(true);
      } else if (err instanceof HttpError && err.status === 404) {
        setError(`No session "${id}" exists yet.`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  useEffect(() => {
    if (authStatus === 'authenticated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shared with manual reloads below; setState only runs after an await
      loadCurrentSessionId();
    }
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === 'authenticated' && sessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shared with manual reloads below; setState only runs after an await
      loadRoster(sessionId);
    }
  }, [authStatus, sessionId]);

  async function updateSession(updates: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update failed');
      // A gameDate change rekeys the session (its id IS the date) — follow
      // it to the new id rather than re-fetching the now-stale old one.
      const newSessionId: string = data?.session?.sessionId || sessionId;
      setSessionId(newSessionId);
      await loadRoster(newSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateSignupStatus(signupId: string, status: SignupStatus) {
    await updateSignupFields(signupId, { status });
  }

  async function updateSignupPaid(signupId: string, paid: boolean) {
    await updateSignupFields(signupId, { paid });
  }

  async function updateSignupFields(signupId: string, updates: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signups/${signupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Update failed');
      await loadRoster(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSignup(signupId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signups/${signupId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Remove failed');
      await loadRoster(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (authStatus === 'loading') return <main className="mx-auto max-w-3xl px-4 py-10 text-slate-500">Loading...</main>;
  if (authStatus === 'unauthenticated') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        <Button onClick={() => signIn('google')} className="mt-4">
          Sign in with Google
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        <span className="text-sm text-slate-600">{authSession?.user?.email}</span>
      </div>

      <Link href="/guidelines" className="mt-1 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <BookOpen className="h-3.5 w-3.5" /> View player guidelines
      </Link>

      {forbidden && (
        <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {authSession?.user?.email} is not on the Admins list.
        </p>
      )}

      {!forbidden && (
        <>
          <div className="mt-4">
            <label htmlFor="admin-session-id" className="block text-sm text-slate-700">Session (defaults to this week&apos;s)</label>
            <input
              id="admin-session-id"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onBlur={() => loadRoster(sessionId)}
              className="mt-1 w-48 rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
              placeholder="YYYY-MM-DD"
            />
          </div>

          {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <CreateSessionForm busy={busy} setBusy={setBusy} setError={setError} onCreated={(id) => setSessionId(id)} />

          {scrimmage && (
            <Card className="mt-4">
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                {scrimmage.gameDate} at {scrimmage.gameTime}
                <Badge status={scrimmage.status}>{scrimmage.status}</Badge>
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="admin-game-date" className="text-sm text-slate-700">Date</label>
                <input
                  id="admin-game-date"
                  type="date"
                  value={gameDateInput}
                  onChange={(e) => setGameDateInput(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <label htmlFor="admin-game-time" className="text-sm text-slate-700">Time</label>
                <input
                  id="admin-game-time"
                  type="time"
                  value={gameTimeInput}
                  onChange={(e) => setGameTimeInput(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => updateSession({ gameDate: gameDateInput, gameTime: gameTimeInput })}
                >
                  {busy ? 'Processing...' : 'Reschedule'}
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Game day must be a Friday, Saturday, or Sunday. Moving it — even to a different week — keeps every existing signup.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="admin-capacity" className="text-sm text-slate-700">Capacity</label>
                <input
                  id="admin-capacity"
                  type="number"
                  min={0}
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(e.target.value)}
                  className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => updateSession({ capacity: Number(capacityInput) })}
                >
                  {busy ? 'Processing...' : 'Save'}
                </Button>
                <label htmlFor="admin-cost" className="ml-3 text-sm text-slate-700">Cost ($)</label>
                <input
                  id="admin-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => updateSession({ cost: Number(costInput) })}
                >
                  {busy ? 'Processing...' : 'Save'}
                </Button>
                {scrimmage.status !== 'cancelled' && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => updateSession({ status: 'cancelled' })}
                    className="ml-auto"
                  >
                    Cancel session (rainout)
                  </Button>
                )}
              </div>
            </Card>
          )}

          {roster && (
            <Card className="mt-4">
              <h2 className="font-semibold text-slate-900">Roster ({roster.length})</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-1 pr-2">Name</th>
                      <th className="py-1 pr-2">Type</th>
                      <th className="py-1 pr-2">Positions</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Paid</th>
                      <th className="py-1 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((s) => (
                      <tr key={s.signupId} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2">{s.fullName}</td>
                        <td className="py-1.5 pr-2">{s.memberStatus === 'guest' ? `guest of ${s.invitedByName}` : 'member'}</td>
                        <td className="py-1.5 pr-2">{s.positions}</td>
                        <td className="py-1.5 pr-2">
                          <select
                            value={s.status}
                            disabled={busy}
                            onChange={(e) => updateSignupStatus(s.signupId, e.target.value as SignupStatus)}
                            className="rounded border border-slate-300 px-1 py-0.5"
                          >
                            <option value="confirmed">confirmed</option>
                            <option value="waitlisted">waitlisted</option>
                            <option value="cancelled">cancelled</option>
                          </select>
                        </td>
                        <td className="py-1.5 pr-2">
                          <input
                            type="checkbox"
                            checked={s.paid}
                            disabled={busy}
                            onChange={(e) => updateSignupPaid(s.signupId, e.target.checked)}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <button
                            disabled={busy}
                            onClick={() => removeSignup(s.signupId)}
                            className="text-red-600 hover:underline disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {sessionId && (
            <AddSignupForm
              sessionId={sessionId}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onAdded={() => loadRoster(sessionId)}
            />
          )}
        </>
      )}
    </main>
  );
}

function CreateSessionForm(props: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onCreated: (sessionId: string) => void;
}) {
  const { busy, setBusy, setError, onCreated } = props;
  const [gameDate, setGameDate] = useState('');
  const [gameTime, setGameTime] = useState('18:00');
  const [capacity, setCapacity] = useState('20');
  const [cost, setCost] = useState('0');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameDate, gameTime, capacity: Number(capacity), cost: Number(cost) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Create failed');
      setGameDate('');
      onCreated(data.session.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <form onSubmit={handleSubmit} className="space-y-2">
        <h2 className="font-semibold text-slate-900">Create a new session</h2>
        <p className="text-xs text-slate-500">Game day must be a Friday, Saturday, or Sunday.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="create-session-date" className="block text-sm text-slate-700">Date</label>
            <input
              id="create-session-date"
              required
              type="date"
              value={gameDate}
              onChange={(e) => setGameDate(e.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="create-session-time" className="block text-sm text-slate-700">Time</label>
            <input
              id="create-session-time"
              required
              type="time"
              value={gameTime}
              onChange={(e) => setGameTime(e.target.value)}
              className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="create-session-capacity" className="block text-sm text-slate-700">Capacity</label>
            <input
              id="create-session-capacity"
              required
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="mt-1 w-20 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="create-session-cost" className="block text-sm text-slate-700">Cost ($)</label>
            <input
              id="create-session-cost"
              type="number"
              min={0}
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="mt-1 w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AddSignupForm(props: {
  sessionId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onAdded: () => void;
}) {
  const { sessionId, busy, setBusy, setError, onAdded } = props;
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [isGuest, setIsGuest] = useState(false);
  const [invitedByName, setInvitedByName] = useState('');
  const [willingToShare, setWillingToShare] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

  function togglePosition(p: string) {
    setPositions((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { email, waiverAccepted: true };
      if (needsProfile) {
        body.profile = { fullName, gender, age: Number(age), savedPositions: positions.join(', ') };
      }
      if (isGuest) {
        body.invitedByName = invitedByName;
        body.willingToShare = willingToShare;
      }
      const res = await fetch(`/api/admin/sessions/${sessionId}/signups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Add failed');
      setEmail('');
      setFullName('');
      setInvitedByName('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <form onSubmit={handleSubmit} className="space-y-2">
        <h2 className="font-semibold text-slate-900">Manually add a signup</h2>
        <p className="text-xs text-slate-500">By adding this signup, you&apos;re confirming this person consented to the waiver.</p>
        <div>
          <label htmlFor="admin-add-email" className="block text-sm text-slate-700">Email</label>
          <input
            id="admin-add-email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={needsProfile} onChange={(e) => setNeedsProfile(e.target.checked)} />
          First time signing up (no saved profile yet)
        </label>
        {needsProfile && (
          <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
            <input
              required
              aria-label="Full name"
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            />
            <div className="flex gap-2">
              <input
                required
                aria-label="Gender"
                placeholder="Gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="flex-1 rounded border border-slate-300 px-2 py-1.5"
              />
              <input
                required
                type="number"
                aria-label="Age"
                placeholder="Age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-24 rounded border border-slate-300 px-2 py-1.5"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((p) => (
                <label key={p} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  <input type="checkbox" checked={positions.includes(p)} onChange={() => togglePosition(p)} />
                  {p}
                </label>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isGuest} onChange={(e) => setIsGuest(e.target.checked)} />
          Guest
        </label>
        {isGuest && (
          <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
            <input
              required
              aria-label="Invited by (member name)"
              placeholder="Invited by (member name)"
              value={invitedByName}
              onChange={(e) => setInvitedByName(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={willingToShare} onChange={(e) => setWillingToShare(e.target.checked)} />
              Willing to share a slot
            </label>
          </div>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Processing...' : 'Add'}
        </Button>
      </form>
    </Card>
  );
}
