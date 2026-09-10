import { Session, Signup } from '../sheets/schema';
import { getSession } from '../sheets/sessions';
import { listSignupsForSession } from '../sheets/signups';
import { normalizeEmail } from './email';
import { computeCostShare } from './payments';
import { positionOf } from './waitlist';

/**
 * "Where do I stand this week?", answered for one player.
 *
 * Read-only, and that is the whole reason it is its own module. It lived at
 * the bottom of signupFlow.ts, a 450-line file of write paths that take the
 * global mutation lock, send email, and cascade promotions — so the one
 * question in it that changes nothing was reached through a door marked with
 * all of that, and a reader had to check whether asking it was safe.
 *
 * Nothing here writes, locks, or notifies. The seam is the natural one: the
 * flows own everything that changes the roster, this owns the reading of it.
 */

export interface MyStatus {
  signup: Signup | null;
  /** Other players' pending requests to share a spot with this caller.
   * `fromGuestInvite` distinguishes a guest who named this caller as their
   * inviter from a waitlisted player asking to sub in — accepting means the
   * same thing mechanically, but the member is owed an accurate description
   * of what they're agreeing to. */
  incomingSubRequests: { fromSignupId: string; fromFullName: string; fromGuestInvite: boolean }[];
  /** This caller's own share of session.cost, or null if not priced yet
   * or the caller isn't confirmed. */
  costOwed: number | null;
  /** 1-based place in the waitlist queue, or null when not waitlisted.
   * Computed server-side so it's still correct for a player who can't see the
   * roster list itself (the roster hides names from non-participants). */
  waitlistPosition: number | null;
}

/**
 * The computation behind getMyStatusForSession, with the fetching lifted out
 * so a caller that already holds the session and its signups — the
 * consolidated /api/home route — can reuse them instead of reading the same
 * two tabs again. Pure.
 */
export function buildMyStatus(session: Session | null, allSignups: Signup[], email: string): MyStatus {
  const normalized = normalizeEmail(email);

  const signup = allSignups.find((s) => normalizeEmail(s.email) === normalized && s.status !== 'cancelled') ?? null;

  const incomingSubRequests = allSignups
    .filter((s) => s.subRequestStatus === 'pending' && normalizeEmail(s.subRequestTargetEmail) === normalized)
    .map((s) => ({
      fromSignupId: s.signupId,
      fromFullName: s.fullName,
      fromGuestInvite: s.memberStatus === 'guest' && s.willingToShare,
    }));

  let costOwed: number | null = null;
  if (signup && signup.status === 'confirmed' && session) {
    costOwed = computeCostShare(session, allSignups)[signup.signupId] ?? null;
  }

  const waitlistPosition =
    signup && signup.status === 'waitlisted' ? positionOf(signup.signupId, allSignups) : null;

  return { signup, incomingSubRequests, costOwed, waitlistPosition };
}

/**
 * Everything the player homepage needs about "me" for this session, fetching
 * the session and its signups once each.
 */
export async function getMyStatusForSession(sessionId: string, email: string): Promise<MyStatus> {
  const [allSignups, session] = await Promise.all([listSignupsForSession(sessionId), getSession(sessionId)]);
  return buildMyStatus(session, allSignups, email);
}
