import { Session } from '../sheets/schema';
import { AdminRosterEntry } from './views';
import { phaseOf, isRegistrationOpen, hasRegistrationClosed, isRosterLocked, hasGameStarted } from './sessionPhase';
import { countConfirmedSpots } from './payments';
import { thresholdFor } from './practicePoll';
import { formatGameDate } from './time';

/**
 * What still needs doing, across every session at once.
 *
 * The dashboard's organizing problem is not editing a session — that was never
 * hard. It is *noticing* which of several sessions needs something, and the
 * answer was previously spread across the components that render each control:
 * `GameDayEmailPanel` decided internally whether its moment had arrived,
 * `PracticePollSection` decided whether to offer the poll, and the rest the
 * organizer held in their head. One session a week made that survivable.
 * Three does not.
 *
 * So the decision is pulled out here, as a pure function over data the console
 * already holds. Nothing in this file touches React, the network or the DOM,
 * which is the same split `adminConsole.ts` draws for the console's other
 * decisions.
 *
 * Deliberately **not** the same thing as `weekWatchdog`. That answers "did a
 * job that should have run silently fail", pushes to a phone, and is about
 * things going wrong. This answers "what is the next thing to press", is read
 * on a screen the organizer is already looking at, and is mostly about things
 * going right in order.
 */
export interface AgendaItem {
  /** Which session, so the line can name a day and the click can select it. */
  sessionId: string;
  /** What to do, in a phrase that fits on one line. */
  message: string;
  /**
   * Lower sorts first. Not a severity: it is roughly "how soon does this stop
   * being possible", which is what decides what to do next when three things
   * are outstanding.
   */
  urgency: number;
}

/** A roster is only needed for the items that count people. */
type Countable = Pick<AdminRosterEntry, 'status' | 'pairId' | 'signupId' | 'paid'>;

/**
 * One session's outstanding work.
 *
 * `roster` may be null, and then the items that need a headcount are skipped
 * rather than guessed at. The console holds the roster for the session being
 * edited and not for the others, so this lets the same function serve both
 * without a second read per session.
 */
export function agendaFor(session: Session, roster: Countable[] | null, now: Date = new Date()): AgendaItem[] {
  const items: AgendaItem[] = [];
  const add = (urgency: number, message: string) => items.push({ sessionId: session.sessionId, message, urgency });

  // A cancelled session has no outstanding work by definition.
  if (session.status === 'cancelled') return items;

  const phase = phaseOf(session, now);
  const day = formatGameDate(session.gameDate);

  // 1. Players are blocked. Nothing else on this session matters more.
  if (isRegistrationOpen(phase) && session.status === 'closed') {
    add(0, `${day} — registration should be open now, but the session is still closed`);
  }

  // 2. The window has passed and it is still marked open. The signup gate is
  //    derived from the schedule so nobody can actually sign up, but the
  //    headcount alert the permit is booked from never fired.
  if (hasRegistrationClosed(phase) && session.status === 'open') {
    add(1, `${day} — registration has closed, but the session is still marked open`);
  }

  if (roster) {
    const confirmed = countConfirmedSpots(roster);

    // 3. Light turnout, and the poll has not been asked. Only while it could
    //    still change anything — after the lock the format is settled.
    if (!isRosterLocked(phase) && hasRegistrationClosed(phase) && session.practicePollStatus === '' && confirmed < thresholdFor(session)) {
      add(2, `${day} — only ${confirmed} confirmed, under the ${thresholdFor(session)} you set for a BP/Practice poll`);
    }

    // 6. Money, once it is final and therefore askable for.
    if (isRosterLocked(phase) && session.pricePerSpot > 0) {
      const unpaid = roster.filter((s) => s.status === 'confirmed' && !s.paid).length;
      if (unpaid > 0) add(5, `${day} — ${unpaid} player${unpaid === 1 ? '' : 's'} still unpaid`);
    }
  }

  // 4. The roster has locked and there are no teams. Not on a practice week:
  //    there are no sides to pick.
  if (isRosterLocked(phase) && !hasGameStarted(phase) && session.format !== 'practice' && session.teamsStatus === '') {
    add(3, `${day} — the roster has locked and teams have not been generated`);
  }

  // 5. The one email that has to go out, and the only thing that records it.
  if (isRosterLocked(phase) && !hasGameStarted(phase) && session.remindersSentAt === '') {
    add(4, `${day} — nobody has been sent the game-day email`);
  }

  // 7. The permit. Quiet until the lock, because "TBD" is a normal state for
  //    most of the week and nagging about it would train the organizer to
  //    ignore this list.
  if (isRosterLocked(phase) && !hasGameStarted(phase) && session.locationName === '') {
    add(6, `${day} — no field is booked yet`);
  }

  return items;
}

/**
 * Every session's outstanding work, most urgent first.
 *
 * Flat across sessions on purpose. That is the whole point: the organizer
 * reads one list instead of opening three dashboards to find out which one
 * needs them.
 */
export function agendaForAll(
  sessions: { session: Session; roster: Countable[] | null }[],
  now: Date = new Date()
): AgendaItem[] {
  return sessions
    .flatMap(({ session, roster }) => agendaFor(session, roster, now))
    .sort((a, b) => a.urgency - b.urgency || a.sessionId.localeCompare(b.sessionId));
}
