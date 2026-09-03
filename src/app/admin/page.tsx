'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { POSITIONS } from '../../lib/positions';

type SignupStatus = 'confirmed' | 'waitlisted' | 'cancelled';
type SessionStatus = 'open' | 'closed' | 'cancelled';

interface SessionInfo {
  sessionId: string;
  gameDate: string;
  gameTime: string;
  capacity: number;
  status: SessionStatus;
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Update failed');
      await loadRoster(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateSignupStatus(signupId: string, status: SignupStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signups/${signupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
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
        <button onClick={() => signIn('google')} className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          Sign in with Google
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        <span className="text-sm text-slate-600">{authSession?.user?.email}</span>
      </div>

      {forbidden && (
        <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {authSession?.user?.email} is not on the Admins list.
        </p>
      )}

      {!forbidden && (
        <>
          <div className="mt-4">
            <label className="block text-sm text-slate-700">Session (defaults to this week&apos;s)</label>
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onBlur={() => loadRoster(sessionId)}
              className="mt-1 w-48 rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
              placeholder="YYYY-MM-DD"
            />
          </div>

          {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {scrimmage && (
            <section className="mt-4 rounded border border-slate-200 p-4">
              <h2 className="font-semibold text-slate-900">
                {scrimmage.gameDate} at {scrimmage.gameTime} — status: {scrimmage.status}
              </h2>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-sm text-slate-700">Capacity</label>
                <input
                  type="number"
                  min={0}
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(e.target.value)}
                  className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  disabled={busy}
                  onClick={() => updateSession({ capacity: Number(capacityInput) })}
                  className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Save
                </button>
                {scrimmage.status !== 'cancelled' && (
                  <button
                    disabled={busy}
                    onClick={() => updateSession({ status: 'cancelled' })}
                    className="ml-auto rounded border border-red-300 px-2 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Cancel session (rainout)
                  </button>
                )}
              </div>
            </section>
          )}

          {roster && (
            <section className="mt-4">
              <h2 className="font-semibold text-slate-900">Roster ({roster.length})</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-1 pr-2">Name</th>
                      <th className="py-1 pr-2">Type</th>
                      <th className="py-1 pr-2">Positions</th>
                      <th className="py-1 pr-2">Status</th>
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
            </section>
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
    <form onSubmit={handleSubmit} className="mt-6 space-y-2 rounded border border-slate-200 p-4">
      <h2 className="font-semibold text-slate-900">Manually add a signup</h2>
      <p className="text-xs text-slate-500">By adding this signup, you&apos;re confirming this person consented to the waiver.</p>
      <div>
        <label className="block text-sm text-slate-700">Email</label>
        <input
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
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          />
          <div className="flex gap-2">
            <input
              required
              placeholder="Gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="flex-1 rounded border border-slate-300 px-2 py-1.5"
            />
            <input
              required
              type="number"
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
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Add
      </button>
    </form>
  );
}
