import { Signup, Session } from '../sheets/schema';
import { countSpots, spotsFor } from './pair';

// Pure capacity and payment maths. Deliberately free of Sheets or other
// server-only imports so client components — the admin dashboard's payment
// summary — can use the same implementation instead of re-deriving pair-aware
// counting and getting it subtly wrong.
//
// The parameters are structural subsets rather than the full Session/Signup
// rows, so the browser's lighter DTOs satisfy them without a cast.

type SpotPriced = Pick<Session, 'pricePerSpot'>;
type Costed = SpotPriced & Pick<Session, 'cost'>;
/** What a row must carry for us to know which spot it occupies. */
type SpotOccupant = Pick<Signup, 'signupId' | 'status' | 'pairId'>;
type Payable = SpotOccupant & Pick<Signup, 'paid' | 'amountPaid'>;

/**
 * A pair (linked via pairId) occupies exactly ONE spot combined (Section
 * 5) — so counting "confirmed spots" means counting distinct pairIds
 * once, not once per row. This is also what makes the "either partner can
 * cancel without freeing the spot" rule work for free: as long as at
 * least one row for a given pairId is still 'confirmed', that pairId is
 * still counted, so the spot stays occupied.
 */
export function countConfirmedSpots(signups: SpotOccupant[]): number {
  return countSpots(signups.filter((s) => s.status === 'confirmed'));
}

/**
 * What each confirmed player owes: a fixed `session.pricePerSpot`, split
 * between the two people sharing a spot when there's a pairId.
 *
 * This used to divide the permit total (`session.cost`) across confirmed
 * spots. That worked for settling up *after* the game, but not for payment
 * before it, because the divisor keeps moving: $100 across 12 confirmed is
 * $8.33 each until someone cancels and it becomes $10.00. Nobody paying on
 * Wednesday could be quoted a number that would still be true on Friday, and
 * "your balance isn't recalculated once you've paid" is impossible to explain
 * when the person beside you paid a different amount for the same game.
 *
 * A fixed price per spot is stable from the moment the session exists, so it
 * can be shown at signup and paid immediately on confirmation. Over- or
 * under-collection against the permit becomes the organizer's float, visible
 * on the admin dashboard rather than implicit. `session.cost` is still
 * recorded, but purely for the organizer's own books. See
 * planner/2026-09-05-location-payments-qol-plan.md, section 3.
 *
 * Still derived rather than stored: what someone *owes* is a calculation, and
 * storing it would let it drift. What they actually *paid* is a fact, and that
 * is stored (Signup.amountPaid).
 */
export function computeCostShare(session: SpotPriced, signups: SpotOccupant[]): Record<string, number> {
  if (!session.pricePerSpot) return {};

  const confirmed = signups.filter((s) => s.status === 'confirmed');

  const perPerson: Record<string, number> = {};
  // A shared spot costs one spot's price between its occupants, keeping the
  // existing "sharing is cheaper" incentive. Split across the rows actually
  // confirmed, so a partner who cancelled doesn't leave the other paying half.
  for (const spot of spotsFor(confirmed)) {
    const each = Math.round((session.pricePerSpot / spot.length) * 100) / 100;
    for (const s of spot) perPerson[s.signupId] = each;
  }
  return perPerson;
}

export interface PaymentSummary {
  /** Total owed across the current confirmed roster. */
  expected: number;
  /** Everything actually received, including from people who later cancelled. */
  collected: number;
  permitCost: number;
  /** collected - permitCost: the organizer's float, positive or negative. */
  surplus: number;
  unpaidCount: number;
}

/** Totals for the admin dashboard — the numbers the organizer actually cares
 * about, rather than a column of checkboxes to eyeball. */
export function computePaymentSummary(session: Costed, signups: Payable[]): PaymentSummary {
  const owedBySignup = computeCostShare(session, signups);
  const expected = Object.values(owedBySignup).reduce((sum, n) => sum + n, 0);
  // Every payment counts, including one from someone who later cancelled —
  // payments are never refunded or recalculated (see the guidelines).
  const collected = signups.reduce((sum, s) => sum + (s.amountPaid || 0), 0);
  const unpaidCount = signups.filter((s) => s.status === 'confirmed' && !s.paid).length;

  return {
    expected: Math.round(expected * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    permitCost: session.cost,
    surplus: Math.round((collected - session.cost) * 100) / 100,
    unpaidCount,
  };
}
