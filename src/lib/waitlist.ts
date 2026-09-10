import { Signup } from '../sheets/schema';
import { spotsFor, spotKey, isPaired } from './pair';

/**
 * The queue for a spot, and who is next out of it.
 *
 * Promotion order is a real rule of this league with several parts —
 * members before sharing-willing guests before other guests, first-come
 * within a tier, and a pair moving as one — and it lived as private
 * functions inside the signup flow, where the only way to ask it anything was
 * to drive a mutation and see what happened.
 *
 * Nothing here writes. It answers questions about an ordering, so the flow
 * that promotes people and the status that tells a player where they stand
 * are reading the same rule rather than each deriving it.
 */

/**
 * Promotion tiers, from Section 6: members first, then guests willing to share
 * a spot, then other guests.
 *
 * Guests who will share come before those who will not because sharing is how
 * a full week fits one more person in — the ordering is what makes the
 * willingness worth declaring.
 */
export function tierOf(signup: Pick<Signup, 'memberStatus' | 'willingToShare'>): number {
  if (signup.memberStatus === 'member') return 0;
  return signup.willingToShare ? 1 : 2;
}

/** One place in the queue: the rows that would be promoted together. */
export interface WaitingSpot {
  signupIds: string[];
  /** Best tier among the rows sharing this spot. */
  tier: number;
  /** Earliest timestamp among them, for first-come ordering. */
  timestamp: string;
}

/**
 * The queue, in the order people would actually be promoted.
 *
 * A pair is one place in it, taking the better tier and the earlier timestamp
 * of its two rows — so agreeing to share never costs a pair its position.
 *
 * A pair with a row already confirmed is not in the queue at all: that pair
 * holds its spot through the other partner, so the waitlisted row is along for
 * the ride rather than waiting for anything. Sections 5 and 6 do not address a
 * pair split across statuses (possible when a guest and a member signed up
 * independently before merging), so this is the interpretation taken.
 */
export function waitingSpots(sessionSignups: Signup[]): WaitingSpot[] {
  const waitlisted = sessionSignups.filter((s) => s.status === 'waitlisted');
  // Only shared spots can appear here: an unpaired row's key is its own, so a
  // solo waitlister can never match one.
  const spotsAlreadyHeld = new Set(
    sessionSignups.filter((s) => s.status === 'confirmed' && isPaired(s)).map(spotKey)
  );

  return spotsFor(waitlisted)
    .filter((spot) => !spotsAlreadyHeld.has(spotKey(spot[0])))
    .map((spot) => ({
      signupIds: spot.map((s) => s.signupId),
      tier: Math.min(...spot.map(tierOf)),
      timestamp: spot.reduce((min, s) => (s.timestamp < min ? s.timestamp : min), spot[0].timestamp),
    }))
    .sort((a, b) => a.tier - b.tier || a.timestamp.localeCompare(b.timestamp));
}

/** Who gets the next spot that frees up, or null when nobody is waiting. */
export function nextInLine(sessionSignups: Signup[]): WaitingSpot | null {
  return waitingSpots(sessionSignups)[0] ?? null;
}

/**
 * This player's place in the queue, 1-based, or null when they are not waiting.
 *
 * Counts *spots*, not rows, because a spot is what the player is queuing for:
 * a waiting pair is one place in line ahead of you, not two, and one spot
 * freeing up is what would reach them. Counting rows told a player three
 * people were ahead of them when only two spots were, and the pair themselves
 * saw two different numbers for the one place they jointly hold. Both halves
 * of a pair now read the same position.
 *
 * Ordered by arrival rather than by the promotion ordering above. The two
 * answer different questions: this one is "how many are ahead of me", and
 * promotion additionally tiers members above guests. So a player low in this
 * list can still be promoted first, and this stays a good-faith indicator
 * rather than a promise about who moves up next.
 *
 * Keeping both in one file is the point — the discrepancy is deliberate, and
 * it is only obvious as a decision when the two sit next to each other. One
 * difference beyond ordering: a waitlisted row whose partner is already
 * confirmed is excluded from `waitingSpots` (their spot is held, so nothing
 * promotes them) but still occupies a place here, because they are still on
 * the list a player is counting along.
 */
export function positionOf(signupId: string, sessionSignups: Signup[]): number | null {
  const queue = sessionSignups
    .filter((s) => s.status === 'waitlisted')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const index = spotsFor(queue).findIndex((spot) => spot.some((s) => s.signupId === signupId));
  return index >= 0 ? index + 1 : null;
}
