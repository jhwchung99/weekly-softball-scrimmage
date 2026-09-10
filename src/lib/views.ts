import { Session, Signup } from '../sheets/schema';
import { normalizeEmail } from './email';
import { analyzeTeam } from './teams';
import { partnerOf } from './pair';

/**
 * What may cross to the client, and nothing else.
 *
 * Every path from a `Signup` row to a browser goes through a function here.
 * That is the whole point of the module: before it existed the rule lived in
 * whichever handler happened to remember it, and one of them didn't — the
 * teams payload declared a five-field member type, forwarded whole sheet rows,
 * and shipped every teammate's email, payment record, attendance and waiver
 * text to any signed-in player. TypeScript stayed quiet because `Signup` is a
 * structural supertype of the narrow type: a row satisfies it, so nothing
 * flagged the difference between what was declared and what was sent.
 *
 * The defence is that these functions *construct* their results field by
 * field. A projection built by listing the fields it wants cannot leak one it
 * did not list, no matter what shape arrives. Spreading a row, or forwarding
 * it because it structurally fits, is the mistake this module exists to make
 * impossible — so don't reintroduce either.
 *
 * The exported types are the wire contract, and the client imports them rather
 * than declaring its own copies.
 */

// ---------------------------------------------------------------------------
// The player-facing roster
// ---------------------------------------------------------------------------

export interface RosterEntry {
  fullName: string;
  positions: string;
  pairedWith: string | null;
}

export interface RosterView {
  confirmedCount: number;
  waitlistedCount: number;
  /** Null unless the viewer has an active signup for this session — counts are
   * public to any signed-in user, names are not. */
  confirmed: RosterEntry[] | null;
  waitlisted: RosterEntry[] | null;
}

function toRosterEntry(s: Signup, active: Signup[]): RosterEntry {
  return { fullName: s.fullName, positions: s.positions, pairedWith: partnerOf(s, active)?.fullName ?? null };
}

/**
 * Builds the player-facing roster from signups already in hand — pure, so the
 * granular /roster route and the consolidated /home route can share one
 * implementation off a single Sheets read.
 *
 * Sharing matters here beyond deduplication: the "names only for
 * participants" rule is an access-control boundary, and having two copies of
 * it is how one of them eventually drifts open.
 */
export function rosterView(allSignups: Signup[], viewerEmail: string): RosterView {
  const active = allSignups.filter((s) => s.status !== 'cancelled');
  const confirmed = active.filter((s) => s.status === 'confirmed');
  const waitlisted = active
    .filter((s) => s.status === 'waitlisted')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const viewer = normalizeEmail(viewerEmail);
  const isParticipant = active.some((s) => normalizeEmail(s.email) === viewer);

  return {
    confirmedCount: confirmed.length,
    waitlistedCount: waitlisted.length,
    confirmed: isParticipant ? confirmed.map((s) => toRosterEntry(s, active)) : null,
    waitlisted: isParticipant ? waitlisted.map((s) => toRosterEntry(s, active)) : null,
  };
}

// ---------------------------------------------------------------------------
// The posted lineup
// ---------------------------------------------------------------------------

/**
 * One player as their teammates see them: who they are and what they cover.
 *
 * `gender` is here because the coverage analyzer needs it to balance and to
 * report deficiencies, and the client runs that same analyzer while the
 * organizer edits. It is the one field on this type that is about the person
 * rather than the lineup, and it earns its place by being load-bearing.
 */
export interface TeamMember {
  signupId: string;
  fullName: string;
  gender: string;
  positions: string;
  pairId: string;
}

export interface TeamView {
  name: string;
  members: TeamMember[];
  /** Lineup slots this team cannot fill at once. 0 means a full fielding nine. */
  deficiency: number;
  /** Which positions go unfilled, for the "notes for team" line. */
  missing: string[];
}

function toTeamMember(s: Signup): TeamMember {
  return {
    signupId: s.signupId,
    fullName: s.fullName,
    gender: s.gender,
    positions: s.positions,
    pairId: s.pairId,
  };
}

/**
 * Rebuilds the team view from stored `teamName` values, for display.
 *
 * Cancelled signups are filtered out, which is the whole implementation of
 * "if someone cancels after teams are posted, that team plays a person
 * short": their row simply stops appearing, and the note under the team
 * recomputes to show what they took with them.
 */
export function teamView(signups: Signup[], teamCount: number): TeamView[] {
  const active = signups.filter((s) => s.status === 'confirmed' && s.teamName);
  const names = Array.from({ length: teamCount }, (_, i) => `Team ${i + 1}`);
  for (const s of active) if (!names.includes(s.teamName)) names.push(s.teamName);

  return names.map((name) => {
    const members = active.filter((s) => s.teamName === name).map(toTeamMember);
    return { name, members, ...analyzeTeam(members) };
  });
}

// ---------------------------------------------------------------------------
// The organizer's roster
// ---------------------------------------------------------------------------

/**
 * One row of the organizer's roster.
 *
 * Wider than the player-facing views, because the organizer's job needs it:
 * `email` to identify a person across rows, the payment fields to reconcile
 * against an e-Transfer history, `attended` to record who turned up.
 *
 * Still a projection, not a row. `waiverText`, `waiverAcceptedAt`, the
 * sub-request fields and `teamName` are all deliberately absent — the console
 * neither renders them nor passes them to anything that does, so sending them
 * is payload the organizer's browser has no use for. Being admin-only is a
 * reason the extra fields are not a disclosure; it is not a reason to send
 * them.
 *
 * The field list is what the console actually consumes: what `RosterTable`
 * renders, plus what `payments` and `audiences` read when the page hands them
 * this roster (`pairId` is here for them, not for rendering).
 */
export interface AdminRosterEntry {
  signupId: string;
  email: string;
  fullName: string;
  memberStatus: Signup['memberStatus'];
  invitedByName: string;
  pairId: string;
  status: Signup['status'];
  positions: string;
  paid: boolean;
  amountPaid: number;
  attended: boolean;
}

/**
 * The full roster as the organizer sees it — every row regardless of status,
 * cancelled ones included, since an admin needs the complete picture.
 *
 * Order is preserved: it is roughly signup order, and `groupRosterByPerson`
 * relies on it to keep a repeat signup reading as one person's history.
 */
export function adminRosterView(signups: Signup[]): AdminRosterEntry[] {
  return signups.map((s) => ({
    signupId: s.signupId,
    email: s.email,
    fullName: s.fullName,
    memberStatus: s.memberStatus,
    invitedByName: s.invitedByName,
    pairId: s.pairId,
    status: s.status,
    positions: s.positions,
    paid: s.paid,
    amountPaid: s.amountPaid,
    attended: s.attended,
  }));
}

// ---------------------------------------------------------------------------
// The session itself
// ---------------------------------------------------------------------------

/**
 * The week, as a player needs to see it.
 *
 * Everything here is on a poster the organizer would happily pin to the fence:
 * when and where the game is, how many spots there are, what one costs.
 *
 * `cost` is the notable absence. That is what the *permit* cost the organizer
 * — their bookkeeping, not the player's business — and it was crossing to
 * every player because the whole row was being serialized. Not personal data,
 * so this is tidiness rather than a leak, but there is no reason for a page to
 * carry a number nobody on it is meant to read. `registrationOpensAt` and
 * `registrationClosesAt` go too: they are the *recorded* timestamps, often
 * blank, and what the client actually renders is the computed schedule (see
 * sessionPhase).
 */
export interface SessionView {
  sessionId: string;
  gameDate: string;
  gameTime: string;
  capacity: number;
  numFields: number;
  status: Session['status'];
  pricePerSpot: number;
  locationArea: string;
  locationName: string;
  locationUrl: string;
  teamsStatus: Session['teamsStatus'];
}

export function sessionView(session: Session): SessionView {
  return {
    sessionId: session.sessionId,
    gameDate: session.gameDate,
    gameTime: session.gameTime,
    capacity: session.capacity,
    numFields: session.numFields,
    status: session.status,
    pricePerSpot: session.pricePerSpot,
    locationArea: session.locationArea,
    locationName: session.locationName,
    locationUrl: session.locationUrl,
    teamsStatus: session.teamsStatus,
  };
}

/**
 * The week as the organizer needs it: everything a player sees, plus `cost`,
 * which is the permit figure they reconcile their float against.
 */
export interface AdminSessionView extends SessionView {
  cost: number;
}

export function adminSessionView(session: Session): AdminSessionView {
  return { ...sessionView(session), cost: session.cost };
}
