import { Signup } from '../sheets/schema';
import { normalizeEmail } from './email';

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

function toEntry(s: Signup, active: Signup[]): RosterEntry {
  const pairedWith = s.pairId ? active.find((o) => o.pairId === s.pairId && o.signupId !== s.signupId)?.fullName ?? null : null;
  return { fullName: s.fullName, positions: s.positions, pairedWith };
}

/**
 * Builds the player-facing roster from signups already in hand — pure, so the
 * granular /roster route and the consolidated /home route can share one
 * implementation off a single Sheets read.
 *
 * Sharing matters here beyond deduplication: the "names only for
 * participants" rule is an access-control boundary, and having two copies of
 * it is how one of them eventually drifts open. See
 * planner/2026-09-05-code-security-review.md, S1.
 */
export function buildRosterView(allSignups: Signup[], viewerEmail: string): RosterView {
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
    confirmed: isParticipant ? confirmed.map((s) => toEntry(s, active)) : null,
    waitlisted: isParticipant ? waitlisted.map((s) => toEntry(s, active)) : null,
  };
}
