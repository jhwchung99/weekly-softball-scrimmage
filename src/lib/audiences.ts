import { computeCostShare } from './payments';
import { Session, Signup } from '../sheets/schema';

// Who each admin-triggered announcement goes to. Pure, and free of Sheets or
// other server-only imports for the same reason payments.ts is: the admin
// dashboard labels its buttons with the recipient count ("Notify 14 players"),
// and a count derived from a second, hand-rolled copy of these rules is a
// count that eventually disagrees with what actually gets sent.
//
// Parameters are structural subsets rather than full rows, so the browser's
// lighter DTOs satisfy them without a cast.

type Announceable = Pick<Session, 'status'>;
type Addressable = Pick<Signup, 'status'>;
type Owing = Pick<Signup, 'signupId' | 'status' | 'pairId' | 'paid'>;

/**
 * Who hears about a change to the session, which depends on what changed.
 *
 * A cancellation goes to the waitlist too: someone waiting for a spot needs to
 * know there is no longer a spot to wait for. Anything else goes to confirmed
 * players only — a waitlisted player isn't turning up at the field, and if
 * they're promoted later the promotion email carries the current time and
 * place anyway. Emailing them about a field they may never visit is exactly
 * the noise this button exists to avoid.
 */
export function sessionChangeAudience<T extends Addressable>(session: Announceable, signups: T[]): T[] {
  const active = signups.filter((s) => s.status !== 'cancelled');
  return session.status === 'cancelled' ? active : active.filter((s) => s.status === 'confirmed');
}

/**
 * Everyone who is playing, owes something, and hasn't paid.
 *
 * Confirmed only, which leaves out one real case on purpose: someone who
 * cancelled after the roster locked still owes for their spot, since payment
 * isn't recalculated (see computeCostShare). But they're no longer on the
 * roster, chasing them is a conversation rather than a mailshot, and the
 * late-cancellation push has already told the organizer it's theirs to have.
 */
export function unpaidAudience<T extends Owing>(
  session: Pick<Session, 'pricePerSpot'>,
  signups: T[]
): { signup: T; owed: number }[] {
  const owed = computeCostShare(session, signups);
  return signups
    .filter((s) => s.status === 'confirmed' && !s.paid && (owed[s.signupId] ?? 0) > 0)
    .map((s) => ({ signup: s, owed: owed[s.signupId] }));
}
