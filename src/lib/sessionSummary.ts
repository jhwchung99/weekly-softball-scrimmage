import { Session } from '../sheets/schema';
import { MySignupView, RosterView, SessionView } from './views';
import { SessionPhase, hasRegistrationClosed, isRosterLocked, hasGameStarted } from './sessionPhase';
import { getWeeklyMilestones, formatEasternMoment, formatGameTime } from './time';

/**
 * The one-line versions of a session, for a card that is collapsed by default.
 *
 * The homepage renders every upcoming session, and each one used to occupy
 * three cards and a dotted timeline — so a two-game week was most of a
 * phone-screen of scrolling before a player reached anything they could act on.
 * These are what a collapsed card shows instead.
 *
 * Pure, like `homeConsole` and `adminAgenda`: no React, no network, no DOM, so
 * the wording can be checked without rendering a page.
 */

/** A session's day and time, compactly: "Fri, Sep 26 · 6pm". */
export function dayLabel(session: Pick<SessionView, 'gameDate' | 'gameTime'>): string {
  const [year, month, day] = session.gameDate.split('-').map(Number);
  // Noon UTC: far enough from either midnight that no zone shifts the date.
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(noonUtc);

  return `${date} · ${formatGameTime(session.gameTime)}`;
}

/**
 * Where the caller stands, in two or three words, or null when they have no
 * signup and the collapsed row should say nothing about them.
 *
 * Short on purpose: it sits at the right-hand end of a collapsed row on a
 * phone, beside the date, and anything longer wraps.
 */
export function standingLabel(signup: MySignupView | null, waitlistPosition: number | null): string | null {
  if (!signup) return null;
  if (signup.status === 'cancelled') return 'cancelled';
  if (signup.status === 'waitlisted') return waitlistPosition ? `waitlist #${waitlistPosition}` : 'waitlisted';
  return signup.paid ? "you're in · paid" : "you're in";
}

/** "14/20" — how full a session is, or null when the viewer cannot be told. */
export function spotsLabel(session: Pick<SessionView, 'capacity'>, roster: RosterView | null): string | null {
  if (!roster) return null;
  return `${roster.confirmedCount}/${session.capacity}`;
}

/**
 * Midnight, said the way a person says it.
 *
 * `formatGameTime('00:00')` gives "12am", so the literal rendering of a
 * Tuesday-midnight close is "Tuesday, September 22 at 12am" — correct, and how
 * nobody thinks about it. It is Monday night to every player who has ever
 * asked. The instant is unchanged; only the sentence moves back a day.
 */
function saidNaturally(at: Date): string {
  const spelled = formatEasternMoment(at);
  if (!spelled.endsWith(' at 12am')) return spelled;

  const previousDay = formatEasternMoment(new Date(at.getTime() - 12 * 60 * 60 * 1000));
  return `${previousDay.replace(/ at .*$/, '')} at midnight`;
}

/**
 * The schedule, as a sentence rather than a diagram.
 *
 * This replaced `WeeklyTimeline`, three dots and two connecting lines in a card
 * of their own. The dots said less than the dates under them did, and cost a
 * card per session on a page that now shows several.
 *
 * Says only what is still ahead. A player reading on Thursday does not need to
 * be told when sign-ups opened, and the two moments that change what they
 * should do are when sign-ups close and when the roster locks, because the lock
 * is when payment opens and cancelling stops pulling in a replacement.
 */
export function scheduleNote(
  session: Pick<Session, 'gameDate' | 'gameTime'> & Partial<Pick<Session, 'rosterLockAt' | 'registrationOpensAt' | 'registrationClosesAt'>>,
  phase: SessionPhase | null
): string {
  const { registrationOpensAt, registrationClosesAt, cutoffStart } = getWeeklyMilestones(
    session.gameDate,
    session.gameTime,
    session
  );

  if (phase === null) return '';

  if (hasGameStarted(phase)) return 'This game has started.';

  if (isRosterLocked(phase)) {
    return `The roster is locked. The game starts at ${formatGameTime(session.gameTime)}. Cancelling now will not pull in a replacement.`;
  }

  const lock = `The roster locks ${saidNaturally(cutoffStart)}, when payment opens.`;

  if (hasRegistrationClosed(phase)) return `Sign-ups have closed. ${lock}`;

  if (phase === 'before') return `Sign-ups open ${saidNaturally(registrationOpensAt)}.`;

  return `Sign-ups close ${saidNaturally(registrationClosesAt)}. ${lock}`;
}
