import { Signup } from '../sheets/schema';

/**
 * Two people sharing one roster spot.
 *
 * A first-class rule of this league that existed only as a string field.
 * Thirteen modules read `pairId` and each worked out for itself what it meant:
 * five separate implementations of "collapse rows sharing a pair into one
 * spot" (capacity counting, cost splitting, waitlist promotion, team sizing
 * and attendance scenarios), four guards against double-pairing in
 * `subRequestFlow` alone with four different messages, and two different
 * strings for the same "(sharing)" label.
 *
 * The invariant is one sentence — **a pair is one spot, and its rows move
 * together** — and everything here is a way of asking about it. Callers ask
 * this module rather than reading the field.
 */

/** The fields a pairing question needs. Narrow, so client DTOs qualify too. */
export type Pairable = Pick<Signup, 'signupId' | 'pairId'>;

/** Is this row sharing its spot with someone? */
export function isPaired(signup: Pairable): boolean {
  return Boolean(signup.pairId);
}

/**
 * The identity of the roster spot this row occupies.
 *
 * A pair's two rows share one key, an unpaired row is its own. This is the
 * whole of "a pair is one spot" as an expression, and it is what every
 * grouping below is built on.
 *
 * The two kinds of key are namespaced because they are drawn from different
 * id spaces that happen to share a type. `pairId || signupId` reads fine and
 * is what the scattered versions of this effectively did, but it lets a row
 * whose signupId equals some other row's pairId land in the wrong spot. Both
 * ids are UUIDs today so that is vanishingly unlikely, and it would be a
 * miscounted roster spot rather than an error if it happened — which is
 * exactly the kind of thing worth making impossible rather than improbable.
 */
export function spotKey(signup: Pairable): string {
  return signup.pairId ? `pair:${signup.pairId}` : `solo:${signup.signupId}`;
}

/**
 * The other half of this row's shared spot, from the rows given, or null.
 *
 * Returns null for an unpaired row and for a pair whose partner is not in
 * `among` — the caller decides which rows are in scope (a roster view passes
 * only active rows, so a partner who cancelled correctly stops being shown).
 */
export function partnerOf<T extends Pairable>(signup: T, among: T[]): T | null {
  if (!isPaired(signup)) return null;
  return among.find((o) => o.pairId === signup.pairId && o.signupId !== signup.signupId) ?? null;
}

/**
 * The given rows grouped into the spots they occupy: one entry per spot,
 * holding the one or two rows that share it.
 *
 * First-appearance order is preserved, both between spots and within one,
 * because callers depend on it — the waitlist is FIFO by signup time, and the
 * team generator's unit order feeds a deterministic shuffle.
 *
 * A pair with only one of its rows present yields a one-row spot rather than
 * being dropped. That is the right reading everywhere it comes up: a partner
 * who cancelled, or who sits outside the filter the caller applied, does not
 * make the remaining row stop occupying a spot.
 */
export function spotsFor<T extends Pairable>(signups: T[]): T[][] {
  const spots: T[][] = [];
  const byKey = new Map<string, T[]>();

  for (const signup of signups) {
    const key = spotKey(signup);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(signup);
      continue;
    }
    const spot = [signup];
    byKey.set(key, spot);
    spots.push(spot);
  }
  return spots;
}

/**
 * How many roster spots these rows occupy.
 *
 * This is what capacity is measured in. It is also what makes "either partner
 * can cancel without freeing the spot" work for free: while one row of a pair
 * is still in the list, that pair still counts once.
 */
export function countSpots(signups: Pairable[]): number {
  return spotsFor(signups).length;
}

/**
 * Why this row may not take on a shared spot, or null if it may.
 *
 * One wording, so the four guards in `subRequestFlow` stop giving three
 * different ones for a single refusal. The caller supplies the subject,
 * because who counts as "you" flips between the two request paths — the asker
 * in `requestSub`, the responder in `respondToSubRequest` — and keeps its own
 * status code, since those two answer 400 and 409 for their own reasons.
 *
 * Says "spot", which CONTEXT.md settles as the word for a place on the roster.
 * "Slot" is reserved for a lineup slot — one of the nine fielding positions
 * and using it for both was the ambiguity worth removing.
 */
export function alreadySharingReason(signup: Pairable, subject: string = "You're"): string | null {
  return isPaired(signup) ? `${subject} already sharing a spot with someone else.` : null;
}

/** How a shared spot is described wherever it is shown to a player. One
 * string, because the roster and the team editor were saying "(sharing a
 * spot)" and "(sharing)" for the same thing. */
export const SHARING_A_SPOT = 'sharing a spot';
