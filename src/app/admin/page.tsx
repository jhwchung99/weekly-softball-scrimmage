'use client';

import { useEffect, useState, FormEvent } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import { BookOpen } from 'lucide-react';
import { POSITIONS } from '../../lib/positions';
import { GENDERS } from '../../lib/genders';
import { TeamEditor } from '../../components/TeamEditor';
import { computePaymentSummary } from '../../lib/payments';
import { sendApiRequest, asJson } from '../../lib/apiRequest';
import type { AnnouncementResult } from '../../lib/adminConsole';
import {
  adminRequestFor,
  type AdminAction,
  classifyLoadFailure,
  sessionIdAfterRevision,
  splitAcrossRoster,
  capacityRaiseWarning,
  announcementNotice,
  sessionInputsFor,
} from '../../lib/adminConsole';
import { sessionChangeAudience, unpaidAudience, messageAudience } from '../../lib/audiences';
import {
  canOpenPracticePoll,
  tallyPracticePoll,
  thresholdFor,
  turnoutRecovered,
  confirmedSpots,
  practiceMessageSubject,
  practiceMessageBody,
} from '../../lib/practicePoll';
import { groupRosterByPerson, countRoster, isActiveSignup } from '../../lib/adminRoster';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { agendaForAll } from '../../lib/adminAgenda';
import { Button } from '../../components/Button';
import { Field, controlClass } from '../../components/Field';

import type { SignupStatus, Session } from '../../sheets/schema';
import type { AdminRosterEntry, AdminSessionView } from '../../lib/views';
import type { SessionPhase } from '../../lib/sessionPhase';
import { isRosterLocked, hasGameStarted } from '../../lib/sessionPhase';
import { paymentOpensAt } from '../../lib/payments';
import { formatEasternMoment } from '../../lib/time';
import { localInputToIso } from '../../lib/adminConsole';

/** The organizer's roster row, as the projection module defines it. */
type AdminSignup = AdminRosterEntry;

/** The week as the projection module sends it to an organizer. */
type SessionInfo = AdminSessionView;

/** One titled band of the session card. The card holds five unrelated groups
 * of settings and used to run them together with only a hairline rule
 * between, so a heading is what tells the organizer where pricing stops and
 * location starts. */
/** The header badge. The phase, not the stored status: signups follow the
 * window, and a stored open or closed no longer says anything (ADR-0009). */
const PHASE_LABELS: Record<SessionPhase, string> = {
  before: 'signups not open yet',
  open: 'signups open',
  closed: 'signups closed',
  locked: 'roster locked',
  played: 'played',
};

function AdminSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-slate-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
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
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [scrimmage, setScrimmage] = useState<SessionInfo | null>(null);
  // From the server, not computed here: whether the roster has locked decides
  // whether the game-day email can go out, and that must not hang on the
  // organizer's own clock (ADR-0003).
  const [phase, setPhase] = useState<SessionPhase | null>(null);
  const [roster, setRoster] = useState<AdminSignup[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sending email is the one thing here with no visible effect on the page,
  // so it needs somewhere to report what it did.
  const [notice, setNotice] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [capacityInput, setCapacityInput] = useState('');
  // The free-typed message, kept apart from noteInput: that one is a gloss on
  // a generated email, this one is the whole email.
  const [subjectInput, setSubjectInput] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [messageWaitlisted, setMessageWaitlisted] = useState(false);
  const [pollClosesAt, setPollClosesAt] = useState('');
  const [pollNotify, setPollNotify] = useState(true);
  const [thresholdInput, setThresholdInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [gameDateInput, setGameDateInput] = useState('');
  const [gameTimeInput, setGameTimeInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [areaInput, setAreaInput] = useState('');
  const [fieldNameInput, setFieldNameInput] = useState('');
  const [fieldUrlInput, setFieldUrlInput] = useState('');
  const [lockInput, setLockInput] = useState('');
  const [opensInput, setOpensInput] = useState('');
  const [closesInput, setClosesInput] = useState('');

  /**
   * Which sessions exist, and which one the console is editing.
   *
   * This took the single session `/api/sessions/current` used to return. That
   * route took the first of Friday/Saturday/Sunday that had a row, so a Sunday
   * game created beside a Friday one could not be opened here at all — the
   * console had no way to name it. The list is what makes every session
   * reachable; `sessionId` is still the one being edited.
   */
  async function loadSessions() {
    const { sessions } = await fetchJson<{ sessions: SessionInfo[] }>('/api/sessions/current');
    setSessions(sessions);
    // Picks a session only when nothing is selected yet, i.e. the first load.
    //
    // Deliberately NOT "re-pick if the selection is missing from the list".
    // That list is served from a 30-second cache, so straight after a
    // reschedule it still holds the old id — and re-picking would throw the
    // organizer back to the session they had just renamed, undoing the follow
    // that sessionIdAfterRevision exists to perform. A selection that really
    // has gone shows the 404 screen, which says so plainly.
    setSessionId((current) => current || sessions[0]?.sessionId || '');
  }

  /** `keepNotice` is for the reload that finishes an action: runAction has
   * already cleared the old notice, and the one the action just set has to
   * survive the reload or the organizer never sees it. */
  async function loadRoster(id: string, { keepNotice = false } = {}) {
    if (!id) return;
    setError(null);
    if (!keepNotice) setNotice(null);
    setForbidden(false);
    setScrimmage(null);
    try {
      const [sessionRes, rosterRes] = await Promise.all([
        fetchJson<{ session: SessionInfo; phase: SessionPhase }>(`/api/admin/sessions/${encodeURIComponent(id)}`),
        fetchJson<{ signups: AdminSignup[] }>(`/api/admin/sessions/${encodeURIComponent(id)}/signups`),
      ]);
      setScrimmage(sessionRes.session);
      setPhase(sessionRes.phase);
      const inputs = sessionInputsFor(sessionRes.session);
      setCapacityInput(inputs.capacity);
      setThresholdInput(String(sessionRes.session.practicePollThreshold || ''));
      setCostInput(inputs.cost);
      setGameDateInput(inputs.gameDate);
      setGameTimeInput(inputs.gameTime);
      setPriceInput(inputs.price);
      setAreaInput(inputs.area);
      setFieldNameInput(inputs.fieldName);
      setFieldUrlInput(inputs.fieldUrl);
      setLockInput(inputs.rosterLock);
      setOpensInput(inputs.registrationOpens);
      setClosesInput(inputs.registrationCloses);
      setRoster(rosterRes.signups);
    } catch (err) {
      const failure = classifyLoadFailure(
        { status: err instanceof HttpError ? err.status : undefined, message: err instanceof Error ? err.message : String(err) },
        id
      );
      setForbidden(failure.forbidden);
      setError(failure.error);
    }
  }

  useEffect(() => {
    if (authStatus === 'authenticated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shared with manual reloads below; setState only runs after an await
      loadSessions();
    }
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === 'authenticated' && sessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shared with manual reloads below; setState only runs after an await
      loadRoster(sessionId);
    }
  }, [authStatus, sessionId]);

  /**
   * Every organizer action, on one policy: mark busy, clear the last error,
   * send the request, show the server's message if it refuses, reload, and
   * stop being busy whatever happened.
   *
   * This was four near-identical handlers. The reload is the part worth
   * keeping together — each of these changes the week, so the console
   * re-reads rather than guessing at the new state.
   */
  async function runAction(action: AdminAction, onDone?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await sendApiRequest(adminRequestFor(action));
      if (onDone) onDone(data);
      else await loadRoster(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function updateSession(updates: Record<string, unknown>, afterSave?: () => void) {
    return runAction({ kind: 'reviseSession', sessionId, updates }, async (data) => {
      // A gameDate change rekeys the session (its id IS the date) — follow it
      // to the new id rather than re-fetching the now-stale old one.
      const newSessionId = sessionIdAfterRevision(sessionId, data?.session as { sessionId?: string });
      setSessionId(newSessionId);
      // The picker shows each session's id and status, and this is the one
      // action that can change either — a reschedule rekeys the row, and
      // opening, closing or cancelling moves the status. Without this the
      // picker keeps showing what the week looked like before the edit.
      await Promise.all([loadRoster(newSessionId, { keepNotice: true }), loadSessions()]);
      afterSave?.();
    });
  }

  /**
   * Behind both of the dashboard's email buttons. Confirms first for the same
   * reason the destructive actions below do: this one can't be taken back
   * either — an email is out of the building the moment it sends, and the
   * audience is everyone.
   */
  function sendAnnouncement(path: string, confirmMessage: string, body: Record<string, unknown> = {}) {
    if (!window.confirm(confirmMessage)) return;
    // `data` is a parsed HTTP body, so it is typed as unknown fields; the
    // notice builder takes the announcement shape as Partial for that reason.
    return runAction({ kind: 'announce', sessionId, path, body }, (data) =>
      setNotice(announcementNotice(data as Partial<AnnouncementResult>))
    );
  }

  /**
   * Open or close the practice poll.
   *
   * Confirms only when it will actually send, unlike sendAnnouncement which
   * always does: closing a poll and opening one quietly both mail nobody, and
   * a dialog on a harmless action teaches the organizer to click through
   * dialogs, which defeats the point of having one (see the capacity save).
   */
  function setPoll(status: 'open' | 'closed') {
    const willEmail = status === 'open' && pollNotify;
    const confirmed = roster?.filter((r) => r.status === 'confirmed').length ?? 0;
    if (willEmail && !window.confirm(`Email ${confirmed} confirmed player${confirmed === 1 ? '' : 's'} asking about BP/Practice?`)) {
      return;
    }
    return runAction(
      { kind: 'announce', sessionId, path: 'practice-poll', body: { status, closesAt: localInputToIso(pollClosesAt), notify: pollNotify } },
      async (data) => {
        const announcement = (data as { announcement?: Partial<AnnouncementResult> }).announcement;
        if (announcement) setNotice(announcementNotice(announcement));
        await loadRoster(sessionId, { keepNotice: true });
      }
    );
  }

  /**
   * Mark the week as BP/Practice, or back to a game.
   *
   * Emails nobody. Marking practice drops a draft into the message box so the
   * telling is one edit away rather than five, but nothing leaves until the
   * organizer presses send.
   */
  function setFormat(format: 'game' | 'practice', session: SessionInfo) {
    // After the save, not before: said first, the notice was cleared by the
    // reload that follows the save, and claimed success when the save failed.
    return updateSession({ format }, () => {
      if (format !== 'practice') return;
      setSubjectInput(practiceMessageSubject(session));
      setMessageInput(practiceMessageBody(session));
      setNotice('Marked as BP/Practice. Nobody has been told: a draft is waiting in Send a message below.');
    });
  }

  function updateSignupFields(signupId: string, updates: Record<string, unknown>) {
    return runAction({ kind: 'overrideSignup', signupId, updates });
  }

  // The three roster checkboxes, each an override of one field.
  const updateSignupStatus = (signupId: string, status: SignupStatus) => updateSignupFields(signupId, { status });
  const updateSignupPaid = (signupId: string, paid: boolean) => updateSignupFields(signupId, { paid });
  const updateSignupAttended = (signupId: string, attended: boolean) => updateSignupFields(signupId, { attended });

  // Both destructive actions confirm first. Removing a signup is a HARD delete
  // of the row (not a status change), and cancelling the session affects
  // everyone — neither should be one stray click away, especially since they
  // sit right next to non-destructive Save buttons.
  function removeSignup(signupId: string, fullName: string) {
    if (!window.confirm(`Permanently remove ${fullName}'s signup? This deletes the row and can't be undone.`)) return;
    return runAction({ kind: 'removeSignup', signupId });
  }

  // Dividing the permit cost across the roster — a suggestion for the price
  // box, worked out here rather than inside the markup.
  const split = splitAcrossRoster(costInput, roster);

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

          {/* Announced: the console's actions mostly leave the page looking
              the same, so this line is the only evidence one failed. */}
          {error && (
            <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {/* The announcement result — who was emailed. Sending is the one
              action with no visible effect on the page, so this line is the
              only evidence of it, seen or heard. */}
          {notice && (
            <p role="status" className="mt-4 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {notice}
            </p>
          )}

          {/* The week: which sessions exist, and what still needs doing
              across all of them. The list appears only when there is a choice
              to make; the agenda whenever it has anything to say. */}
          {sessions.length > 1 && (
            <Card className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session</h2>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Which session">
                {sessions.map((s) => {
                  const chosen = s.sessionId === sessionId;
                  return (
                    <button
                      key={s.sessionId}
                      type="button"
                      aria-pressed={chosen}
                      disabled={busy}
                      onClick={() => setSessionId(s.sessionId)}
                      className={`rounded-full border px-3 py-1 text-sm ${
                        chosen
                          ? 'border-blue-600 bg-blue-50 font-medium text-blue-800'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {/* ISO here, not a human date: on this page the date *is*
                          the session's id, and the organizer matches it against
                          the spreadsheet (voice.md rule 2). */}
                      {s.sessionId}
                      {s.status === 'cancelled' ? ' · cancelled' : ''}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <NeedsYou
            sessions={sessions}
            selectedId={sessionId}
            roster={roster}
            busy={busy}
            onSelect={setSessionId}
          />

          <CreateSessionForm
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onCreated={async (id) => {
              setSessionId(id);
              await loadSessions();
            }}
          />

          {scrimmage && (
            <Card className="mt-4">
              {/* The rainout button belongs to the whole session, not to
                  pricing: it used to sit at the end of the settings row, where
                  ml-auto parked it beside "Split across roster". */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                  {scrimmage.gameDate} at {scrimmage.gameTime}
                  {scrimmage.status === 'cancelled' ? (
                    <Badge status="cancelled">cancelled</Badge>
                  ) : (
                    phase && <Badge status={phase === 'open' ? 'open' : 'closed'}>{PHASE_LABELS[phase]}</Badge>
                  )}
                </h2>
                {scrimmage.status !== 'cancelled' && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Cancel the whole ${scrimmage.gameDate} scrimmage? Everyone signed up will see it as cancelled.`)) {
                        updateSession({ status: 'cancelled' });
                      }
                    }}
                  >
                    Cancel session (rainout)
                  </Button>
                )}
              </div>

              {/* Signups follow the session's own window, with nothing to run
                  (ADR-0009). These move the window's open or close time to
                  now, and a cancelled game is restored the same way. */}
              <AdminSection title="Registration">
                <div className="flex flex-wrap items-center gap-2">
                  {scrimmage.status === 'cancelled' ? (
                    <Button size="sm" variant="success" disabled={busy} onClick={() => updateSession({ status: 'open' })}>
                      Restore game
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant={phase === 'before' ? 'success' : 'secondary'}
                        disabled={busy || phase !== 'before'}
                        onClick={() => updateSession({ status: 'open' })}
                      >
                        Open signups now
                      </Button>
                      <Button
                        size="sm"
                        variant={phase === 'open' ? 'danger' : 'secondary'}
                        disabled={busy || phase !== 'open'}
                        onClick={() => updateSession({ status: 'closed' })}
                      >
                        Close signups now
                      </Button>
                      <span className="text-xs text-slate-500">Sets the open or close time below to now.</span>
                    </>
                  )}
                </div>
              </AdminSection>

<PracticePollSection
                session={scrimmage}
                roster={roster ?? []}
                thresholdInput={thresholdInput}
                setThresholdInput={setThresholdInput}
                closesAt={pollClosesAt}
                setClosesAt={setPollClosesAt}
                notify={pollNotify}
                setNotify={setPollNotify}
                busy={busy}
                onSetPoll={setPoll}
                onSetFormat={(format) => setFormat(format, scrimmage)}
                onSaveThreshold={() => updateSession({ practicePollThreshold: Number(thresholdInput) || 0 })}
              />

              {/* Setup: the things set once when a session is made and then
                  left alone — the schedule, what it costs, where it is. They
                  used to sit between the actions, so "Open registration" was
                  two panels away from "Send the game-day email" despite being
                  next in the same sequence. Closed by default; the actions
                  above and the roster below are what the organizer is here
                  for. */}
              <details className="mt-4 border-t border-slate-100 pt-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Setup — schedule, capacity, cost, location
                </summary>
                <div className="mt-2">
<AdminSection title="Schedule">
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Date" htmlFor="admin-game-date">
                    <input
                      id="admin-game-date"
                      type="date"
                      value={gameDateInput}
                      onChange={(e) => setGameDateInput(e.target.value)}
                      className={`${controlClass} w-full`}
                    />
                  </Field>
                  <Field label="Time" htmlFor="admin-game-time">
                    <input
                      id="admin-game-time"
                      type="time"
                      value={gameTimeInput}
                      onChange={(e) => setGameTimeInput(e.target.value)}
                      className={`${controlClass} w-full`}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => updateSession({ gameDate: gameDateInput, gameTime: gameTimeInput })}
                    >
                      {busy ? 'Processing...' : 'Reschedule'}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
                    Game day can be any day. Moving it, even to a different week, keeps every existing signup. A Monday game
                    needs its own registration times below — the usual window would close after it had been played.
                  </p>

                  {/* The roster lock. Blank means the default, five hours before
                      the game. Set for an early game, so the lock, the teams and
                      the one email all land the evening before rather than at
                      dawn. */}
                  <Field
                    label="Roster locks"
                    htmlFor="admin-lock"
                    hint="Blank uses the usual 5 hours before the game. Payment, teams and the game-day email all follow this."
                    className="sm:col-span-2 lg:col-span-3"
                  >
                    <input
                      id="admin-lock"
                      type="datetime-local"
                      value={lockInput}
                      onChange={(e) => setLockInput(e.target.value)}
                      className={`${controlClass} w-full sm:w-auto`}
                    />
                    <Button size="sm" disabled={busy} onClick={() => updateSession({ rosterLockAt: localInputToIso(lockInput) })}>
                      Save lock
                    </Button>
                  </Field>

                  {/* The registration window. Blank on both means the usual
                      Monday 9am to Tuesday midnight, derived from the game
                      date — which is what almost every week uses. Set them for
                      a midweek game, or to run a second session on its own
                      schedule. */}
                  <Field
                    label="Registration opens"
                    htmlFor="admin-opens"
                    hint="Blank uses the usual Monday 9am before the game."
                    className="sm:col-span-2 lg:col-span-3"
                  >
                    <input
                      id="admin-opens"
                      type="datetime-local"
                      value={opensInput}
                      onChange={(e) => setOpensInput(e.target.value)}
                      className={`${controlClass} w-full sm:w-auto`}
                    />
                  </Field>
                  <Field
                    label="Registration closes"
                    htmlFor="admin-closes"
                    hint="Blank uses the usual Tuesday midnight. Must come before the roster lock."
                    className="sm:col-span-2 lg:col-span-3"
                  >
                    <input
                      id="admin-closes"
                      type="datetime-local"
                      value={closesInput}
                      onChange={(e) => setClosesInput(e.target.value)}
                      className={`${controlClass} w-full sm:w-auto`}
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        updateSession({
                          registrationOpensAt: localInputToIso(opensInput),
                          registrationClosesAt: localInputToIso(closesInput),
                        })
                      }
                    >
                      Save window
                    </Button>
                  </Field>
                </div>
              </AdminSection>

<AdminSection title="Capacity and cost">
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Capacity" htmlFor="admin-capacity">
                    <input
                      id="admin-capacity"
                      type="number"
                      min={0}
                      value={capacityInput}
                      onChange={(e) => setCapacityInput(e.target.value)}
                      className={`${controlClass} w-20`}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        // The one save on this page that emails players: a raise
                        // promotes off the waitlist and tells each of them they
                        // are in. Never one stray click away.
                        const warning = capacityRaiseWarning(scrimmage.capacity, Number(capacityInput), roster);
                        if (warning && !window.confirm(warning)) return;
                        updateSession({ capacity: Number(capacityInput) });
                      }}
                    >
                      {busy ? 'Processing...' : 'Save'}
                    </Button>
                  </Field>
                  <Field label="Fields" htmlFor="admin-fields">
                    <select
                      id="admin-fields"
                      value={scrimmage.numFields}
                      disabled={busy}
                      onChange={(e) => updateSession({ numFields: Number(e.target.value) })}
                      className={`${controlClass} w-full`}
                    >
                      <option value={1}>1 (two teams)</option>
                      <option value={2}>2 (four teams)</option>
                    </select>
                  </Field>
                  <Field label="Cost ($)" htmlFor="admin-cost">
                    <input
                      id="admin-cost"
                      type="number"
                      min={0}
                      step="0.01"
                      value={costInput}
                      onChange={(e) => setCostInput(e.target.value)}
                      className={`${controlClass} w-24`}
                    />
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => updateSession({ cost: Number(costInput) })}>
                      {busy ? 'Processing...' : 'Save'}
                    </Button>
                  </Field>
                  <Field
                    label="Price/spot ($)"
                    htmlFor="admin-price"
                    hint={
                      split.canSplit
                        ? `$${split.total.toFixed(2)} / ${split.spots} confirmed = $${split.each.toFixed(2)} each`
                        : undefined
                    }
                    className="sm:col-span-2"
                  >
                    <input
                      id="admin-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      className={`${controlClass} w-24`}
                    />
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => updateSession({ pricePerSpot: Number(priceInput) })}>
                      {busy ? 'Processing...' : 'Save'}
                    </Button>
                    {/* Fills the box above from the permit cost, so it sits with
                        the field it writes to rather than at the end of the row. */}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !split.canSplit}
                      onClick={() => setPriceInput(String(split.each))}
                    >
                      Split across roster
                    </Button>
                  </Field>
                </div>
              </AdminSection>

{/* Location arrives in two stages: the area up front, the actual
                  field once the permit is booked. */}
              <AdminSection title="Location">
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Area" htmlFor="admin-area">
                    <input
                      id="admin-area"
                      placeholder="Mississauga"
                      value={areaInput}
                      onChange={(e) => setAreaInput(e.target.value)}
                      className={`${controlClass} w-full`}
                    />
                  </Field>
                  <Field label="Field (once booked)" htmlFor="admin-field">
                    <input
                      id="admin-field"
                      placeholder="Iceland Park Diamond 3"
                      value={fieldNameInput}
                      onChange={(e) => setFieldNameInput(e.target.value)}
                      className={`${controlClass} w-full`}
                    />
                  </Field>
                  <Field label="Map link" htmlFor="admin-field-url">
                    <input
                      id="admin-field-url"
                      type="url"
                      placeholder="https://maps.app.goo.gl/..."
                      value={fieldUrlInput}
                      onChange={(e) => setFieldUrlInput(e.target.value)}
                      className={`${controlClass} w-full`}
                    />
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        updateSession({ locationArea: areaInput, locationName: fieldNameInput, locationUrl: fieldUrlInput })
                      }
                    >
                      {busy ? 'Processing...' : 'Save location'}
                    </Button>
                  </div>
                </div>
              </AdminSection>
                </div>
              </details>

              <NotifyPlayersPanel
                session={scrimmage}
                roster={roster ?? []}
                note={noteInput}
                setNote={setNoteInput}
                busy={busy}
                onSend={(confirmMessage, body) => sendAnnouncement('notify', confirmMessage, body)}
              />

              <MessagePlayersPanel
                roster={roster ?? []}
                subject={subjectInput}
                setSubject={setSubjectInput}
                message={messageInput}
                setMessage={setMessageInput}
                includeWaitlisted={messageWaitlisted}
                setIncludeWaitlisted={setMessageWaitlisted}
                busy={busy}
                onSend={(confirmMessage, body) => sendAnnouncement('message', confirmMessage, body)}
              />
            </Card>
          )}

          {roster && (
            <Card className="mt-4">
              {(() => {
                // The heading used to count every row, so a week with three
                // re-signups claimed a roster three larger than the number of
                // people actually playing.
                const counts = countRoster(roster);
                return (
                  <h2 className="font-semibold text-slate-900">
                    Roster ({counts.active} active
                    {counts.cancelled > 0 && ` · ${counts.cancelled} cancelled`})
                  </h2>
                );
              })()}
              {scrimmage && scrimmage.pricePerSpot > 0 && (() => {
                // Shared with the server rather than recomputed here: a pair
                // splits one spot's price, so counting confirmed *people*
                // would overstate what's owed.
                const summary = computePaymentSummary(scrimmage, roster);
                return (
                  <>
                    <p className="mt-1 text-sm text-slate-600">
                      Collected <strong>${summary.collected.toFixed(2)}</strong> of ${summary.expected.toFixed(2)} expected
                      {summary.permitCost > 0 && (
                        <>
                          {' · '}permit ${summary.permitCost.toFixed(2)}
                          {' · '}
                          <span className={summary.surplus < 0 ? 'text-red-700' : 'text-green-700'}>
                            {summary.surplus < 0 ? 'short' : 'surplus'} ${Math.abs(summary.surplus).toFixed(2)}
                          </span>
                        </>
                      )}
                      {' · '}{summary.unpaidCount} unpaid
                    </p>
                    <RemindUnpaidButton
                      session={scrimmage}
                      roster={roster}
                      busy={busy}
                      onSend={(confirmMessage) => sendAnnouncement('payment-reminders', confirmMessage)}
                    />
                  </>
                );
              })()}
              <RosterTable
                roster={roster}
                busy={busy}
                onStatusChange={updateSignupStatus}
                onPaidChange={updateSignupPaid}
                onAttendedChange={updateSignupAttended}
                onRemove={removeSignup}
              />
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

          {/* Same reason the player view hides the rosters: a BP/Practice
              week has no sides, so offering to generate them is offering to
              post advice that does not apply. */}
          {sessionId && scrimmage?.format !== 'practice' && (
            <TeamEditor sessionId={sessionId} onChanged={() => loadRoster(sessionId)} />
          )}

          {sessionId && scrimmage && roster && (
            <GameDayEmailPanel
              session={scrimmage}
              phase={phase}
              roster={roster}
              busy={busy}
              onSend={(confirmMessage) => sendAnnouncement('game-day-email', confirmMessage)}
            />
          )}
        </>
      )}
    </main>
  );
}

/**
 * The full roster, grouped by person.
 *
 * Unlike the player-facing view this shows cancelled rows too — an admin needs
 * the complete picture. Rendered flat in sheet order they read as separate
 * people, which is how a stale row from a re-signup ends up looking like a
 * duplicate. Grouping is the fix; lib/adminRoster.ts holds the rules.
 */
/**
 * What still needs doing, across every session at once.
 *
 * The reason the dashboard needed reorganizing. Editing a session was never
 * the hard part; *noticing* which of several needs something is, and that
 * knowledge used to be spread across the components that render each control —
 * each deciding internally whether its moment had arrived — plus whatever the
 * organizer held in their head. One session a week made that survivable.
 *
 * Flat across sessions on purpose: one list to read, not three dashboards to
 * open. Each line selects the session it names, so noticing and acting are the
 * same click.
 *
 * The roster is only available for the session being edited, so the items that
 * count people appear for that one and are skipped for the rest rather than
 * guessed at. That is `agendaFor`'s null-roster path, and it is why this needs
 * no extra fetch per session.
 */
export function NeedsYou(props: {
  sessions: SessionInfo[];
  selectedId: string;
  roster: AdminSignup[] | null;
  busy: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const { sessions, selectedId, roster, busy, onSelect } = props;

  const items = agendaForAll(
    sessions.map((session) => ({
      // The view carries everything agendaFor reads; the cast is to the sheet
      // row type it is declared against.
      session: session as unknown as Session,
      roster: session.sessionId === selectedId ? roster : null,
    }))
  );

  if (items.length === 0) return null;

  return (
    <Card className="mt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs you</h2>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={`${item.sessionId}:${item.message}`} className="text-sm text-slate-700">
            <button
              type="button"
              disabled={busy}
              onClick={() => onSelect(item.sessionId)}
              className="text-left hover:underline disabled:no-underline"
            >
              {item.message}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RosterTable(props: {
  roster: AdminSignup[];
  busy: boolean;
  onStatusChange: (signupId: string, status: SignupStatus) => void;
  onPaidChange: (signupId: string, paid: boolean) => void;
  onAttendedChange: (signupId: string, attended: boolean) => void;
  onRemove: (signupId: string, fullName: string) => void;
}) {
  const { roster, busy, onStatusChange, onPaidChange, onAttendedChange, onRemove } = props;

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2">Type</th>
            <th className="py-1 pr-2">Positions</th>
            <th className="py-1 pr-2">Status</th>
            <th className="py-1 pr-2">Paid</th>
            <th className="py-1 pr-2">Here</th>
            <th className="py-1 pr-2"></th>
          </tr>
        </thead>
        <tbody>
          {groupRosterByPerson(roster).flatMap((group) =>
            group.rows.map((s, indexInGroup) => {
              const active = isActiveSignup(s);
              const isRepeat = indexInGroup > 0;
              // The rule sits under the person rather than under every row, so
              // one person's rows read as a block.
              const endsGroup = indexInGroup === group.rows.length - 1;
              // Two rows can belong to one person, so a bare name doesn't
              // identify a control — "Paid: Kevin Kim" would name two
              // checkboxes. Screen readers get the same distinction the table
              // draws visually.
              const rowLabel = isRepeat
                ? `${s.fullName} (${active ? 'second active signup' : 'earlier signup'})`
                : s.fullName;

              return (
                <tr
                  key={s.signupId}
                  className={`${endsGroup ? 'border-b border-slate-100' : ''} ${active ? '' : 'text-slate-400'}`}
                >
                  <td className="py-1.5 pr-2">
                    {isRepeat ? (
                      // Repeat rows say nothing where the name goes: the name
                      // belongs to the group, and repeating it is what made one
                      // person look like two. An extra *active* row isn't
                      // history, though — it's the double-booking the badge
                      // below is warning about.
                      <span className="ml-3 text-xs italic">
                        {active ? '↳ second active signup' : '↳ earlier signup'}
                      </span>
                    ) : (
                      <>
                        {s.fullName}
                        {group.activeCount > 1 && (
                          <span
                            className="ml-1 rounded bg-red-100 px-1 text-xs font-medium text-red-700"
                            title="This person has more than one active signup — they are taking two spots and will be billed twice. Cancel or remove one."
                          >
                            duplicate
                          </span>
                        )}
                        {/* Two rows named "Kevin Kim" are otherwise
                            indistinguishable; the email is the identity
                            everything else in the app keys on. */}
                        <span className="block text-xs font-normal text-slate-400">{group.email}</span>
                      </>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {s.memberStatus === 'guest' ? `guest of ${s.invitedByName}` : 'member'}
                  </td>
                  <td className="py-1.5 pr-2">{s.positions}</td>
                  <td className="py-1.5 pr-2">
                    <select
                      value={s.status}
                      aria-label={`Status: ${rowLabel}`}
                      disabled={busy}
                      onChange={(e) => onStatusChange(s.signupId, e.target.value as SignupStatus)}
                      className="rounded border border-slate-300 px-1 py-0.5"
                    >
                      <option value="confirmed">confirmed</option>
                      <option value="waitlisted">waitlisted</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <input
                      type="checkbox"
                      aria-label={`Paid: ${rowLabel}`}
                      checked={s.paid}
                      disabled={busy}
                      onChange={(e) => onPaidChange(s.signupId, e.target.checked)}
                    />
                    {s.paid && s.amountPaid > 0 && (
                      <span className="ml-1 text-xs text-slate-500">${s.amountPaid.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Attended: ${rowLabel}`}
                      checked={s.attended}
                      disabled={busy}
                      onChange={(e) => onAttendedChange(s.signupId, e.target.checked)}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <button
                      disabled={busy}
                      onClick={() => onRemove(s.signupId, s.fullName)}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The "Notify players" control on the session card.
 *
 * Nothing else on that card emails anybody. Booking a permit takes several
 * saves — area, then field, then map link — and players don't need one email
 * per save, so telling them is a separate decision made here. See
 * lib/announcements.ts.
 */
export function NotifyPlayersPanel(props: {
  session: Pick<SessionInfo, 'status'>;
  roster: AdminSignup[];
  note: string;
  setNote: (note: string) => void;
  busy: boolean;
  onSend: (confirmMessage: string, body: Record<string, unknown>) => void;
}) {
  const { session, roster, note, setNote, busy, onSend } = props;
  const cancelled = session.status === 'cancelled';
  // The same rule the server sends by, so the count on the button is the
  // number of emails that actually go out.
  const audience = sessionChangeAudience(session, roster);
  const people = `${audience.length} player${audience.length === 1 ? '' : 's'}`;

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <label htmlFor="admin-note" className="block text-sm text-slate-700">
        Notify players {cancelled ? '(confirmed and waitlisted)' : '(confirmed only)'}
      </label>
      <textarea
        id="admin-note"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note, included in the email — e.g. why the field moved"
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={cancelled ? 'danger' : 'secondary'}
          disabled={busy || audience.length === 0}
          onClick={() =>
            onSend(`Email ${people} about ${cancelled ? 'the cancellation' : 'these details'}?`, { note })
          }
        >
          {busy ? 'Sending...' : `Notify ${people}`}
        </Button>
        <span className="text-xs text-slate-500">
          {cancelled
            ? 'Tells everyone still signed up that the game is off, waitlist included.'
            : 'Emails the current date, time and field. Waitlisted players get the details with their promotion instead.'}
        </span>
      </div>
    </div>
  );
}

/**
 * The practice poll, and the format it exists to inform.
 *
 * Renders nothing at all on a normal, healthy week: no poll, a full roster,
 * and a game. A disabled button that can never be pressed is noise on a card
 * that has just had its clutter cut, so the whole section stays away until
 * there is something to decide.
 */
export function PracticePollSection(props: {
  session: SessionInfo;
  roster: AdminSignup[];
  thresholdInput: string;
  setThresholdInput: (v: string) => void;
  closesAt: string;
  setClosesAt: (v: string) => void;
  notify: boolean;
  setNotify: (v: boolean) => void;
  busy: boolean;
  onSetPoll: (status: 'open' | 'closed') => void;
  onSetFormat: (format: 'game' | 'practice') => void;
  onSaveThreshold: () => void;
}) {
  const {
    session,
    roster,
    thresholdInput,
    setThresholdInput,
    closesAt,
    setClosesAt,
    notify,
    setNotify,
    busy,
    onSetPoll,
    onSetFormat,
    onSaveThreshold,
  } = props;

  const spots = confirmedSpots(roster);
  const threshold = thresholdFor(session);
  const canOpen = canOpenPracticePoll(session, roster);
  const pollOpen = session.practicePollStatus === 'open';
  const everAsked = session.practicePollStatus !== '';
  const practice = session.format === 'practice';

  // Nothing to say: no poll has been asked for, the week is a game, and
  // turnout is fine.
  if (!everAsked && !practice && !canOpen) return null;

  const tally = tallyPracticePoll(roster);
  const recovered = turnoutRecovered(session, roster);

  return (
    <AdminSection title="BP/Practice">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Light week below"
          htmlFor="admin-practice-threshold"
          hint={`${spots} confirmed spot${spots === 1 ? '' : 's'} now. Blank uses the usual ${threshold}.`}
        >
          <input
            id="admin-practice-threshold"
            type="number"
            min={0}
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            className={`${controlClass} w-20`}
          />
          <Button size="sm" variant="secondary" disabled={busy} onClick={onSaveThreshold}>
            {busy ? 'Processing...' : 'Save'}
          </Button>
        </Field>

        {!pollOpen && (
          <Field
            label="Answer by (optional)"
            htmlFor="admin-practice-closes"
            hint="Shown to players. Nothing closes on its own: you close the poll when you are ready."
            className="sm:col-span-2"
          >
            <input
              id="admin-practice-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className={`${controlClass} w-full sm:w-auto`}
            />
          </Field>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          {pollOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetPoll('closed')}>
                Close poll
              </Button>
              <span className="text-xs text-slate-500">
                Yes {tally.yes}, no {tally.no}, no answer {tally.unanswered}. Closing emails nobody.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={busy || !canOpen} onClick={() => onSetPoll('open')}>
                {everAsked ? 'Reopen poll' : 'Open practice poll'}
              </Button>
              <label htmlFor="admin-practice-notify" className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  id="admin-practice-notify"
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                />
                Email confirmed players that the poll is open
              </label>
            </div>
          )}
        </div>

        {pollOpen && (tally.yes > 0 || tally.no > 0) && (
          <p className="text-xs text-slate-600 sm:col-span-2 lg:col-span-3">
            {tally.yes > 0 && <>Yes: {tally.yesNames.join(', ')}. </>}
            {tally.no > 0 && <>No: {tally.noNames.join(', ')}. </>}
            {tally.unanswered > 0 && <>No answer: {tally.unansweredNames.join(', ')}.</>}
          </p>
        )}

        {recovered && (
          <p className="text-xs text-amber-700 sm:col-span-2 lg:col-span-3">
            {spots} confirmed spots now, at or above the {threshold} you set. The poll is still open: close it if
            this week is a game after all.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
          <Button
            size="sm"
            variant={practice ? 'secondary' : 'secondary'}
            disabled={busy}
            onClick={() => onSetFormat(practice ? 'game' : 'practice')}
          >
            {practice ? 'Mark as a game' : 'Mark as BP/Practice'}
          </Button>
          <span className="text-xs text-slate-500">
            {practice
              ? 'This week is BP/Practice. No teams, and the emails say so.'
              : 'Emails nobody. Marking it drops a draft into Send a message below.'}
          </span>
        </div>
      </div>
    </AdminSection>
  );
}

/**
 * "Send a message" — a subject and body the organizer writes in full.
 *
 * Deliberately not a mode of the panel above. That one's email is generated
 * from the session and its text box is a note attached to it, so its trailing
 * line explains what will be appended. Here nothing is appended, which is the
 * entire point: an organizer who wants to say "we need two more for Friday"
 * has no template to fight with.
 *
 * Send stays disabled until both fields have something in them. The server
 * rejects blanks too, but a button that offers to mail an empty subject to
 * twenty people and then fails is a worse way to learn that.
 */
export function MessagePlayersPanel(props: {
  roster: AdminSignup[];
  subject: string;
  setSubject: (subject: string) => void;
  message: string;
  setMessage: (message: string) => void;
  includeWaitlisted: boolean;
  setIncludeWaitlisted: (include: boolean) => void;
  busy: boolean;
  onSend: (confirmMessage: string, body: Record<string, unknown>) => void;
}) {
  const { roster, subject, setSubject, message, setMessage, includeWaitlisted, setIncludeWaitlisted, busy, onSend } =
    props;
  // The same rule the server sends by, so the count on the button is the
  // number of emails that actually go out.
  const audience = messageAudience(roster, includeWaitlisted);
  const people = `${audience.length} player${audience.length === 1 ? '' : 's'}`;
  const ready = subject.trim().length > 0 && message.trim().length > 0;

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Send a message</h3>
      <div className="mt-2 grid gap-x-4 gap-y-3">
        <Field label="Subject" htmlFor="admin-message-subject">
          <input
            id="admin-message-subject"
            maxLength={150}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Bring a bat if you have one"
            className={`${controlClass} w-full`}
          />
        </Field>
        <Field label="Message" htmlFor="admin-message-body">
          <textarea
            id="admin-message-body"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Sent exactly as written. Nothing about the date, field or payment is added."
            className={`${controlClass} w-full`}
          />
        </Field>
        <label htmlFor="admin-message-waitlist" className="flex items-center gap-2 text-sm text-slate-700">
          <input
            id="admin-message-waitlist"
            type="checkbox"
            checked={includeWaitlisted}
            onChange={(e) => setIncludeWaitlisted(e.target.checked)}
          />
          Include waitlisted players
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !ready || audience.length === 0}
            onClick={() => onSend(`Email ${people} the message "${subject.trim()}"?`, { subject, message, includeWaitlisted })}
          >
            {busy ? 'Sending...' : `Send to ${people}`}
          </Button>
          <span className="text-xs text-slate-500">
            Goes out as written, under your subject line. Nothing is added to it.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Remind unpaid" control beside the payment summary.
 *
 * Renders nothing when nobody owes, so the dashboard doesn't offer a button
 * whose only possible outcome is "nothing sent".
 */
export function RemindUnpaidButton(props: {
  session: Pick<SessionInfo, 'pricePerSpot'>;
  roster: AdminSignup[];
  busy: boolean;
  onSend: (confirmMessage: string) => void;
}) {
  const { session, roster, busy, onSend } = props;
  // Not the summary's unpaidCount: that counts everyone confirmed and unpaid,
  // including anyone whose share works out to nothing. This button's audience
  // is the people who actually owe.
  const toNudge = unpaidAudience(session, roster);
  if (toNudge.length === 0) return null;

  const people = `${toNudge.length} unpaid player${toNudge.length === 1 ? '' : 's'}`;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => onSend(`Email ${people} about what they owe?`)}
      >
        {busy ? 'Sending...' : `Remind ${toNudge.length} unpaid`}
      </Button>
      <span className="text-xs text-slate-500">
        Skips anyone already ticked as paid. Before the roster locks the email says when payment opens rather than
        asking for it.
      </span>
    </div>
  );
}


/**
 * "Send game-day email" — the one player email the organizer sends on purpose.
 *
 * Appears only once the roster has locked, which for most weeks is game day
 * and for an early game is the evening before. That is not presentation: the
 * email states what each player owes, and until the lock a cancellation can
 * still move that figure, so there is nothing honest to send. Before the lock
 * the panel says when the lock is rather than hiding, so the organizer knows
 * what they are waiting for instead of hunting for a missing button.
 */
export function GameDayEmailPanel(props: {
  session: Pick<SessionInfo, 'status' | 'gameDate' | 'gameTime' | 'rosterLockAt' | 'remindersSentAt'>;
  phase: SessionPhase | null;
  roster: AdminSignup[];
  busy: boolean;
  onSend: (confirmMessage: string) => void;
}) {
  const { session, phase, roster, busy, onSend } = props;
  if (session.status === 'cancelled' || phase === null) return null;
  // Nothing useful to send once people are on the field.
  if (hasGameStarted(phase)) return null;

  const audience = roster.filter((s) => s.status === 'confirmed');
  const people = `${audience.length} player${audience.length === 1 ? '' : 's'}`;
  const sentAt = session.remindersSentAt ? formatEasternMoment(new Date(session.remindersSentAt)) : '';

  return (
    <Card className="mt-4">
      <h2 className="font-semibold text-slate-900">Game-day email</h2>
      {!isRosterLocked(phase) ? (
        <p className="mt-1 text-sm text-slate-600">
          Sends once the roster locks, {formatEasternMoment(paymentOpensAt(session))}. Until then a cancellation can
          still change what people owe, so the email has nothing final to tell them.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="success"
              disabled={busy || audience.length === 0}
              onClick={() => onSend(`Email ${people} that the game is on, with what they owe?`)}
            >
              {busy ? 'Sending...' : sentAt ? `Send again to ${people}` : `Send to ${people}`}
            </Button>
            <span className="text-xs text-slate-500">
              Where and when, the posted teams, and each player&apos;s share. Confirmed players only.
            </span>
          </div>
          {sentAt && <p className="mt-2 text-xs text-green-700">Sent {sentAt}.</p>}
        </>
      )}
    </Card>
  );
}

export function CreateSessionForm(props: {
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
  const [pricePerSpot, setPricePerSpot] = useState('10');
  const [area, setArea] = useState('');
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await sendApiRequest({
        url: '/api/admin/sessions',
        init: asJson({
          gameDate,
          gameTime,
          capacity: Number(capacity),
          cost: Number(cost),
          pricePerSpot: Number(pricePerSpot),
          locationArea: area,
          // '' on both means the usual Monday-to-Tuesday window, derived from
          // the game date. A midweek game has to fill them in, and the server
          // refuses to create one that does not.
          registrationOpensAt: localInputToIso(opens),
          registrationClosesAt: localInputToIso(closes),
        }),
        fallbackError: 'Create failed',
      });
      setGameDate('');
      setOpens('');
      setCloses('');
      onCreated((data.session as { sessionId: string }).sessionId);
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
        <p className="text-xs text-slate-500">
          Game day can be any day. Signups open and close on their own at the registration times, so nobody can sign
          up early. Leave them blank for the usual Monday 9am to Tuesday midnight — a Monday game needs its own, because
          the usual window would close after it had been played.
        </p>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Date" htmlFor="create-session-date">
            <input
              id="create-session-date"
              required
              type="date"
              value={gameDate}
              onChange={(e) => setGameDate(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Time" htmlFor="create-session-time">
            <input
              id="create-session-time"
              required
              type="time"
              value={gameTime}
              onChange={(e) => setGameTime(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Capacity" htmlFor="create-session-capacity">
            <input
              id="create-session-capacity"
              required
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Permit cost ($)" htmlFor="create-session-cost">
            <input
              id="create-session-cost"
              type="number"
              min={0}
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Price/spot ($)" htmlFor="create-session-price">
            <input
              id="create-session-price"
              type="number"
              min={0}
              step="0.01"
              value={pricePerSpot}
              onChange={(e) => setPricePerSpot(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Area" htmlFor="create-session-area">
            <input
              id="create-session-area"
              placeholder="Mississauga"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Registration opens" htmlFor="create-session-opens" hint="Blank = the usual Monday 9am.">
            <input
              id="create-session-opens"
              type="datetime-local"
              value={opens}
              onChange={(e) => setOpens(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <Field label="Registration closes" htmlFor="create-session-closes" hint="Blank = the usual Tuesday midnight.">
            <input
              id="create-session-closes"
              type="datetime-local"
              value={closes}
              onChange={(e) => setCloses(e.target.value)}
              className={`${controlClass} w-full`}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

export function AddSignupForm(props: {
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
        body.profile = { fullName, gender, savedPositions: positions.join(', ') };
      }
      if (isGuest) {
        body.invitedByName = invitedByName;
        body.willingToShare = willingToShare;
      }
      await sendApiRequest({
        url: `/api/admin/sessions/${encodeURIComponent(sessionId)}/signups`,
        init: asJson(body),
        fallbackError: 'Add failed',
      });
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
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Gender</legend>
              {GENDERS.map((g) => (
                <label key={g} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  <input
                    type="radio"
                    name="admin-gender"
                    value={g}
                    required
                    checked={gender === g}
                    onChange={() => setGender(g)}
                  />
                  {g}
                </label>
              ))}
            </fieldset>
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
              Willing to share a spot
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
