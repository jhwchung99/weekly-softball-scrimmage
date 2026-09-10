import { countConfirmedSpots } from './payments';
import { AdminRosterEntry, AdminSessionView } from './views';

/**
 * The organizer console's decisions, separated from its rendering.
 *
 * The console's presentational parts were exported so tests could reach them,
 * and they are tested. The state machine they sit inside — load, mutate,
 * reload, interpret the result — was not reachable by any test, and that is
 * exactly where the last roster bug was fixed. The parts that decide something
 * live here instead, as plain functions over plain data, so they can be
 * checked without rendering a page.
 *
 * Nothing here touches React, the network or the DOM. What is left in the page
 * is holding state and drawing it.
 */

/** Something the organizer can do from the console. */
export type AdminAction =
  | { kind: 'reviseSession'; sessionId: string; updates: Record<string, unknown> }
  | { kind: 'announce'; sessionId: string; path: string; body?: Record<string, unknown> }
  | { kind: 'overrideSignup'; signupId: string; updates: Record<string, unknown> }
  | { kind: 'removeSignup'; signupId: string };

export interface AdminRequest {
  url: string;
  init: RequestInit;
  /** Shown when the server fails without saying why. */
  fallbackError: string;
}

const asJson = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * The request one organizer action makes.
 *
 * The console had four handlers of the same shape — mark busy, clear the
 * error, send, throw the server's message or a fallback, reload, report, stop
 * being busy. The homepage had the same four and they were collapsed into one
 * policy plus data; the console was left alone, which is the least defensible
 * state to be in: the pattern named, demonstrated, and half-applied.
 *
 * Ids are encoded, because a signup id ends up in the path.
 */
export function adminRequestFor(action: AdminAction): AdminRequest {
  switch (action.kind) {
    case 'reviseSession':
      return {
        url: `/api/admin/sessions/${encodeURIComponent(action.sessionId)}`,
        init: asJson(action.updates, 'PATCH'),
        fallbackError: 'Update failed',
      };
    case 'announce':
      return {
        url: `/api/admin/sessions/${encodeURIComponent(action.sessionId)}/${action.path}`,
        init: asJson(action.body ?? {}),
        fallbackError: 'Send failed',
      };
    case 'overrideSignup':
      return {
        url: `/api/admin/signups/${encodeURIComponent(action.signupId)}`,
        init: asJson(action.updates, 'PATCH'),
        fallbackError: 'Update failed',
      };
    case 'removeSignup':
      return {
        url: `/api/admin/signups/${encodeURIComponent(action.signupId)}`,
        init: { method: 'DELETE' },
        fallbackError: 'Remove failed',
      };
  }
}

/**
 * What to tell the organizer when a request fails.
 *
 * The server's own message when it sent one — those are written for a reader
 * ("Kevin Kim already has an active signup for this session") and are far
 * better than anything generic.
 */
export function adminFailureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error ? error : fallback;
}

/** A request that failed with a status the console treats specially. */
export interface FailedRequest {
  status?: number;
  message: string;
}

/** What the console shows after a failed load. */
export interface LoadFailure {
  /** Show the "you are not an admin" screen rather than an error line. */
  forbidden: boolean;
  /** The message to show, or null when `forbidden` covers it. */
  error: string | null;
}

/**
 * How a failed load becomes something the organizer can act on.
 *
 * The three cases mean different things and deserve different screens: not
 * being an admin is not an error to retry, a session that does not exist yet
 * is a normal state on a Monday morning, and anything else is a genuine
 * failure whose message is worth showing verbatim.
 */
export function classifyLoadFailure(failure: FailedRequest, sessionId: string): LoadFailure {
  if (failure.status === 401 || failure.status === 403) {
    return { forbidden: true, error: null };
  }
  if (failure.status === 404) {
    return { forbidden: false, error: `No session "${sessionId}" exists yet.` };
  }
  return { forbidden: false, error: failure.message };
}

/**
 * Which session the console should be looking at after an edit.
 *
 * A session's id *is* its game date, so rescheduling rekeys the row. The
 * console has to follow it to the new id, or its next action lands on a
 * session that no longer exists — invisible until the organizer tries to edit
 * the week they just moved. Falls back to the current id when the response
 * does not name one, so a partial response cannot strand the console on
 * nothing.
 */
export function sessionIdAfterRevision(currentId: string, revised: { sessionId?: string } | null | undefined): string {
  return revised?.sessionId || currentId;
}

export interface RosterSplit {
  /** Confirmed spots, which is what the total divides by. */
  spots: number;
  total: number;
  /** What one spot would cost, rounded to the cent. 0 when there is nothing
   * to divide. */
  each: number;
  /** Whether there is anything to divide at all. */
  canSplit: boolean;
}

/**
 * Dividing the permit cost across the roster, to fill in the price box.
 *
 * A suggestion, not a rule: once saved, the price is a fixed stored number, so
 * a later cancellation must not silently re-price people who have already paid.
 *
 * Divides by confirmed **spots**, not people, because a pair pays one spot's
 * price between them — dividing by heads would under-collect by exactly the
 * number of shared spots.
 */
export function splitAcrossRoster(costInput: string, roster: AdminRosterEntry[] | null): RosterSplit {
  const spots = countConfirmedSpots(roster ?? []);
  const total = Number(costInput);
  const canSplit = Number.isFinite(total) && total > 0 && spots > 0;
  return { spots, total, each: canSplit ? Math.round((total / spots) * 100) / 100 : 0, canSplit };
}

/** What the app reports back after sending an announcement. */
export interface AnnouncementResult {
  skipped?: boolean;
  reason?: string;
  sent?: number;
  failed?: number;
  recipients?: string[];
}

/**
 * What the organizer is told after pressing an email button.
 *
 * Sending is the one action here with no visible effect on the page, so this
 * line is the only evidence it happened.
 *
 * Names rather than a count: "Emailed 12 players" is impossible to check, and
 * what an organizer wants to know afterwards is whether one particular person
 * was on the list. A skipped send is not a failure — "everyone has already
 * paid" is a legitimate answer to the question the button asks.
 */
export function announcementNotice(result: AnnouncementResult): string {
  if (result.skipped) return `Nothing sent — ${result.reason}`;

  const who = (result.recipients ?? []).join(', ');
  const sent = result.sent ?? 0;
  return (result.failed ?? 0) > 0
    ? `Emailed ${sent}: ${who}. ${result.failed} failed to send — check the logs.`
    : `Emailed ${sent}: ${who}.`;
}

/** The session fields the console mirrors into editable inputs. */
export interface SessionInputs {
  capacity: string;
  cost: string;
  gameDate: string;
  gameTime: string;
  price: string;
  area: string;
  fieldName: string;
  fieldUrl: string;
}

/**
 * The edit form's starting values for a session.
 *
 * Eight of the console's state slots are just session fields mirrored into
 * inputs, and they have to be refilled together every time a session loads
 * missing one leaves a box showing the previous week's value, which the
 * organizer would then save.
 */
export function sessionInputsFor(session: AdminSessionView): SessionInputs {
  return {
    capacity: String(session.capacity),
    cost: String(session.cost),
    gameDate: session.gameDate,
    gameTime: session.gameTime,
    price: String(session.pricePerSpot),
    area: session.locationArea,
    fieldName: session.locationName,
    fieldUrl: session.locationUrl,
  };
}
