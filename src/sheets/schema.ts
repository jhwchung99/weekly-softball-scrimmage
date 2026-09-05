// Types and Sheet<->object (de)serialization for the three data tabs
// described in PROJECT_GUIDELINES.md Section 3. Sheets cells are always
// strings, so every row type has a serialize/parse pair here rather than
// scattering `String(x)` / `x === 'TRUE'` conversions through repository
// code.

export type SessionStatus = 'open' | 'closed' | 'cancelled';
export type SignupStatus = 'confirmed' | 'waitlisted' | 'cancelled';
export type MemberStatus = 'member' | 'guest';

export interface Session {
  sessionId: string;
  gameDate: string; // ISO date, e.g. "2026-09-11"
  gameTime: string; // e.g. "18:00"
  registrationOpensAt: string; // ISO datetime
  registrationClosesAt: string; // ISO datetime
  capacity: number;
  status: SessionStatus;
  cost: number; // total session cost (e.g. permit fee), admin-set; 0 = not
  // priced yet. Split across confirmed slots at display time
  // (computeCostShare in signupFlow.ts) — never stored per-person, so it
  // can't drift if headcount or cost changes before payment happens.
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
  // ledger; see planner/2026-09-04-sub-requests-roster-cost-plan.md)
  subRequestTargetEmail: string; // who this signup is asking to share a
  // slot with; '' when no request is outstanding
  subRequestStatus: '' | 'pending' | 'declined'; // '' = no active request.
  // No 'accepted' value: on acceptance the pair is formed via pairId (the
  // permanent record) and these three fields reset back to ''/empty.
  subRequestedAt: string; // ISO datetime, '' when no request is outstanding
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

// Raw row shape as read back from the sheet: same keys, every value a string.
export type RawRow<T> = { [K in keyof T]: string };

export function parseSessionRow(row: RawRow<Session>): Session {
  return {
    ...row,
    capacity: Number(row.capacity) || 0,
    status: (row.status || 'open') as SessionStatus,
    cost: Number(row.cost) || 0,
  };
}

export function serializeSessionRow(session: Session): RawRow<Session> {
  return { ...session, capacity: String(session.capacity), cost: String(session.cost) };
}

export function parseSignupRow(row: RawRow<Signup>): Signup {
  return {
    ...row,
    willingToShare: row.willingToShare === 'TRUE' || row.willingToShare === 'true',
    memberStatus: (row.memberStatus || 'guest') as MemberStatus,
    status: (row.status || 'waitlisted') as SignupStatus,
    paid: row.paid === 'TRUE' || row.paid === 'true',
    subRequestStatus: (row.subRequestStatus || '') as Signup['subRequestStatus'],
  };
}

export function serializeSignupRow(signup: Signup): RawRow<Signup> {
  return {
    ...signup,
    willingToShare: signup.willingToShare ? 'TRUE' : 'FALSE',
    paid: signup.paid ? 'TRUE' : 'FALSE',
  };
}

export function parsePlayerRow(row: RawRow<Player>): Player {
  return { ...row };
}

export function serializePlayerRow(player: Player): RawRow<Player> {
  return { ...player };
}
