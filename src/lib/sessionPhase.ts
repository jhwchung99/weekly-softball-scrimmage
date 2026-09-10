import { Session } from '../sheets/schema';
import { getWeeklyMilestones } from './time';

/**
 * Where a week stands, asked and answered in one place.
 *
 * "Is registration open", "is the roster locked", "has the game started" were
 * derived independently in eight places, each writing its own comparison
 * against a milestone. Three of those were in the browser and compared against
 * the *viewer's* clock, so two people looking at the same session on two
 * devices could be told different things about whether the roster was locked.
 *
 * The milestone arithmetic — Eastern time, DST, the Monday/Tuesday schedule —
 * already lived in one place (`getWeeklyMilestones`). What did not was the
 * comparison to now. This module is the only thing that makes it, it takes an
 * injectable clock, and the server sends the answer to the client rather than
 * letting the client work it out again.
 *
 * See planner/2026-09-09-architecture-review.html, candidate 3.
 */
export type SessionPhase =
  /** Before registration opens — the week exists but nobody can sign up yet. */
  | 'before'
  /** Registration is open: Monday 9am ET until Tuesday midnight ET. */
  | 'open'
  /** Registration has closed, but the roster is still moving — cancellations
   * still free spots and the waitlist still promotes into them. */
  | 'closed'
  /** Inside the promotion cutoff (5 hours before game time). The roster stops
   * auto-promoting, and payment opens. */
  | 'locked'
  /** Game time has passed. */
  | 'played';

/** The session fields a phase depends on. Deliberately narrow, so callers can
 * pass a client DTO as readily as a sheet row. */
export type Scheduled = Pick<Session, 'gameDate' | 'gameTime'>;

/**
 * The phase this session is in at `now`.
 *
 * Derived from the game date and time rather than the session's `status`
 * field. The two are checked together at the signup gate — `status` alone was
 * once the whole gate, which made it a single point of failure, because
 * anything that flipped a session open accepted signups immediately whatever
 * the calendar said (see signupFlow's requireOpenSessionAndProfile).
 */
export function phaseOf(session: Scheduled, now: Date = new Date()): SessionPhase {
  const { registrationOpensAt, registrationClosesAt, cutoffStart, gameStart } = getWeeklyMilestones(
    session.gameDate,
    session.gameTime
  );

  if (now < registrationOpensAt) return 'before';
  if (now < registrationClosesAt) return 'open';
  if (now < cutoffStart) return 'closed';
  if (now < gameStart) return 'locked';
  return 'played';
}

/**
 * The questions the app actually asks, named once.
 *
 * Without these, each caller re-decides which phases count as "locked" — and
 * getting that wrong is silent, because every phase is a plausible-looking
 * string. `isRosterLocked` covering 'played' as well as 'locked' is exactly
 * the kind of detail that was previously re-derived per call site.
 */

/** Signups are being accepted. */
export function isRegistrationOpen(phase: SessionPhase): boolean {
  return phase === 'open';
}

/** Registration has closed, whether or not the roster has locked since. */
export function hasRegistrationClosed(phase: SessionPhase): boolean {
  return phase === 'closed' || phase === 'locked' || phase === 'played';
}

/**
 * Inside the promotion cutoff: the waitlist stops promoting automatically and
 * payment opens. Stays true once the game has started — a game in progress is
 * not a roster that has reopened.
 */
export function isRosterLocked(phase: SessionPhase): boolean {
  return phase === 'locked' || phase === 'played';
}

/** Game time has passed. */
export function hasGameStarted(phase: SessionPhase): boolean {
  return phase === 'played';
}
