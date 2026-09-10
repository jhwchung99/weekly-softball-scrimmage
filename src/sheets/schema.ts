// Types and Sheet<->object (de)serialization for the data tabs described
// in PROJECT_GUIDELINES.md Section 3, plus the Feedback tab added later. Sheets cells are always
// strings, so every row type has a serialize/parse pair here rather than
// scattering `String(x)` / `x === 'TRUE'` conversions through repository
// code.

import { FeedbackKind } from '../lib/feedbackKinds';

export type SessionStatus = 'open' | 'closed' | 'cancelled';
export type SignupStatus = 'confirmed' | 'waitlisted' | 'cancelled';
export type MemberStatus = 'member' | 'guest';
export type TeamsStatus = '' | 'draft' | 'posted';

export interface Session {
  sessionId: string;
  gameDate: string; // ISO date, e.g. "2026-09-11"
  gameTime: string; // e.g. "18:00"
  registrationOpensAt: string; // ISO datetime
  registrationClosesAt: string; // ISO datetime
  capacity: number;
  status: SessionStatus;
  cost: number; // what the permit actually cost the organizer. Bookkeeping
  // only as of 2026-09-05 — no longer divided among players (see
  // pricePerSpot). 0 = not recorded yet.
  pricePerSpot: number; // what a player pays for one spot, fixed and known up
  // front so it can be shown at signup and paid before game day. A shared
  // spot splits this between its two occupants (computeCostShare). 0 = free /
  // not priced yet.
  locationArea: string; // the general area, known at creation — e.g.
  // "Mississauga". Shown as "<area> (specific field TBD)" until the permit is
  // actually booked.
  locationName: string; // the specific field, filled in once booked — e.g.
  // "Iceland Park Diamond 3". '' until then.
  locationUrl: string; // optional map link for locationName; '' if none.
  numFields: number; // how many diamonds are booked. Teams = numFields * 2, so
  // a second field means four teams. 0/1 both read as one field.
  teamsStatus: TeamsStatus; // '' none yet, 'draft' generated and editable by
  // the admin, 'posted' visible to players. Three states rather than two
  // booleans because the generate cron's idempotency check is `=== ''` and the
  // Post button is the draft -> posted transition.
}

export interface Signup {
  signupId: string;
  sessionId: string;
  email: string;
  fullName: string;
  gender: string;
  memberStatus: MemberStatus;
  invitedByName: string; // '' when memberStatus === 'member'
  willingToShare: boolean; // guest only; false when memberStatus === 'member'
  pairId: string; // '' when not paired
  status: SignupStatus;
  timestamp: string; // ISO datetime, used for FIFO ordering
  positions: string; // comma-separated, carried over from Player.savedPositions
  waiverAcceptedAt: string; // ISO datetime — Section 9; every signup requires this
  waiverText: string; // the exact wording accepted, not just a boolean —
  // stronger evidence than a checkbox flag if the wording ever changes later
  paid: boolean; // admin-tracked, per session — a person who owes for one
  // week still owes it even after paying for a later week (no cross-week
  // ledger)
  amountPaid: number; // what they actually handed over. Recorded because it's
  // a fact, unlike the owed amount, which stays derived. Payment is not
  // refunded or recalculated afterwards — including a late cancellation — so
  // this is the settled figure. 0 when unpaid.
  paidAt: string; // ISO datetime the payment was recorded, '' when unpaid —
  // lets the organizer reconcile against an e-Transfer history by date.
  attended: boolean; // admin-only record of who actually showed up. No
  // player-facing display and no automatic consequence: repeat no-shows are a
  // social problem, and the app's job is only to remember what happened.
  subRequestTargetEmail: string; // who this signup is asking to share a
  // spot with; '' when no request is outstanding
  subRequestStatus: '' | 'pending' | 'declined'; // '' = no active request.
  // No 'accepted' value: on acceptance the pair is formed via pairId (the
  // permanent record) and these three fields reset back to ''/empty.
  subRequestedAt: string; // ISO datetime, '' when no request is outstanding
  teamName: string; // which team this player was put on; '' before teams are
  // generated. Written on the signup rather than a separate tab so reading a
  // session's teams costs no extra Sheets read.
}

export interface Player {
  email: string;
  fullName: string;
  gender: string;
  savedPositions: string; // comma-separated
}

export const SESSION_HEADERS = [
  'sessionId',
  'gameDate',
  'gameTime',
  'registrationOpensAt',
  'registrationClosesAt',
  'capacity',
  'status',
  'cost',
  'pricePerSpot',
  'locationArea',
  'locationName',
  'locationUrl',
  'numFields',
  'teamsStatus',
] as const satisfies readonly (keyof Session)[];

export const SIGNUP_HEADERS = [
  'signupId',
  'sessionId',
  'email',
  'fullName',
  'gender',
  'memberStatus',
  'invitedByName',
  'willingToShare',
  'pairId',
  'status',
  'timestamp',
  'positions',
  'waiverAcceptedAt',
  'waiverText',
  'paid',
  'subRequestTargetEmail',
  'subRequestStatus',
  'subRequestedAt',
  'amountPaid',
  'paidAt',
  'attended',
  'teamName',
] as const satisfies readonly (keyof Signup)[];

export const PLAYER_HEADERS = [
  'email',
  'fullName',
  'gender',
  'savedPositions',
] as const satisfies readonly (keyof Player)[];

// Admin allowlist (Section 8) — deliberately a Sheet tab, not an env var,
// so admins can be added/removed without a redeploy.
export interface Admin {
  email: string;
}

export const ADMIN_HEADERS = ['email'] as const satisfies readonly (keyof Admin)[];

/**
 * A bug report or suggestion sent from the site's feedback button.
 *
 * Append-only and deliberately separate from the weekly data: nothing in
 * the app ever reads this tab back, it exists so the organizer has a
 * durable, searchable record instead of a push notification they might
 * swipe away. `submittedAt` is what makes it a log rather than a pile.
 */
export interface Feedback {
  feedbackId: string;
  submittedAt: string; // ISO datetime the report was received
  kind: FeedbackKind;
  email: string; // from the verified session, so it's who to reply to
  fullName: string; // the Google account's display name; '' if it had none
  message: string;
  pageUrl: string; // the path they were on, '' when not a same-site path
}

export const FEEDBACK_HEADERS = [
  'feedbackId',
  'submittedAt',
  'kind',
  'email',
  'fullName',
  'message',
  'pageUrl',
] as const satisfies readonly (keyof Feedback)[];

// Raw row shape as read back from the sheet: same keys, every value a string.
export type RawRow<T> = { [K in keyof T]: string };

export function parseSessionRow(row: RawRow<Session>): Session {
  return {
    ...row,
    capacity: Number(row.capacity) || 0,
    // Defaults CLOSED, not open: a blank cell means "nobody has said this is
    // open", and for an availability flag the safe reading of silence is no.
    // Defaulting to open meant a hand-edited or half-written row accepted
    // signups on its own.
    status: (row.status || 'closed') as SessionStatus,
    cost: Number(row.cost) || 0,
    pricePerSpot: Number(row.pricePerSpot) || 0,
    // A blank cell means one field, the way it has always worked.
    numFields: Number(row.numFields) || 1,
    teamsStatus: (row.teamsStatus || '') as TeamsStatus,
  };
}

export function serializeSessionRow(session: Session): RawRow<Session> {
  return {
    ...session,
    capacity: String(session.capacity),
    cost: String(session.cost),
    pricePerSpot: String(session.pricePerSpot),
    numFields: String(session.numFields),
  };
}

export function parseSignupRow(row: RawRow<Signup>): Signup {
  return {
    ...row,
    willingToShare: row.willingToShare === 'TRUE' || row.willingToShare === 'true',
    memberStatus: (row.memberStatus || 'guest') as MemberStatus,
    status: (row.status || 'waitlisted') as SignupStatus,
    paid: row.paid === 'TRUE' || row.paid === 'true',
    subRequestStatus: (row.subRequestStatus || '') as Signup['subRequestStatus'],
    amountPaid: Number(row.amountPaid) || 0,
    attended: row.attended === 'TRUE' || row.attended === 'true',
  };
}

export function serializeSignupRow(signup: Signup): RawRow<Signup> {
  return {
    ...signup,
    willingToShare: signup.willingToShare ? 'TRUE' : 'FALSE',
    paid: signup.paid ? 'TRUE' : 'FALSE',
    amountPaid: String(signup.amountPaid),
    attended: signup.attended ? 'TRUE' : 'FALSE',
  };
}

// Player has no non-string fields left (age was removed 2026-09-05), so these
// two are currently identity transforms. Kept rather than inlined so every tab
// has the same parse/serialize pair — the day Player gains a number or boolean,
// the conversion has an obvious home and no call site has to change.
export function parsePlayerRow(row: RawRow<Player>): Player {
  return { ...row };
}

export function serializePlayerRow(player: Player): RawRow<Player> {
  return { ...player };
}

/** Like Player's, near-identity transforms — `kind` is the one field with a
 * narrower type than the string the sheet hands back. */
export function parseFeedbackRow(row: RawRow<Feedback>): Feedback {
  return { ...row, kind: (row.kind || 'feedback') as FeedbackKind };
}

export function serializeFeedbackRow(feedback: Feedback): RawRow<Feedback> {
  return { ...feedback };
}
