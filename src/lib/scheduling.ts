import { getSession, getSessionsByIds, updateSession } from '../sheets/sessions';
import { listSignupsForSession } from '../sheets/signups';
import { currentWeekGameDayCandidates, getWeeklyMilestones, formatEasternMoment } from './time';
import { phaseOf, isRegistrationOpen, hasRegistrationClosed, isRosterLocked, hasGameStarted } from './sessionPhase';
import { countConfirmedSpots, computeCostShare, paymentOpensAt } from './payments';
import { ApiError } from './apiErrors';
import { sendOpenSpotsAlert, sendGameDayReminderEmail, sendHeadcountAlert, deliver } from './notifications';
import { withMutationLock } from './lock';

export const DEFAULT_GAME_TIME = process.env.SESSION_DEFAULT_GAME_TIME || '18:00';
export const DEFAULT_CAPACITY = Number(process.env.SESSION_DEFAULT_CAPACITY) || 20;
// What one spot costs a player. Fixed rather than derived from the permit
// total so the number is stable and knowable at signup time — see
export const DEFAULT_PRICE_PER_SPOT = Number(process.env.SESSION_DEFAULT_PRICE_PER_SPOT) || 0;

// The clock-window mechanism that used to live here is gone. Both jobs now
// decide whether there is work to do by looking at the session's own state and
// schedule, which is correct however late GitHub fires the workflow — and it
// fires it routinely late, by five hours or more. See
// openRegistrationForUpcomingSession for what that cost.

export interface ScheduleResult {
  sessionId: string;
  skipped: boolean;
  reason?: string;
}

/**
 * What a job did to each of the week's sessions.
 *
 * A week can hold more than one game, so both jobs act on all of them rather
 * than on whichever one a lookup happened to return first. Reported per
 * session because "skipped" and "acted" can both be true of one run: the
 * Friday game may already be open while the Sunday one is not.
 */
export interface ScheduleRunResult {
  results: ScheduleResult[];
  /** How many sessions this run actually changed. */
  changed: number;
}

/**
 * Monday 9am ET: open registration for the coming week's games, creating a
 * default Friday one if the organizer has not set any up.
 *
 * Two things changed here on 2026-09-22.
 *
 * **It acts on every session the week holds**, not the first one found. A week
 * with a Friday and a Sunday game has two rosters to open, and opening only one
 * of them was the old behaviour purely because the lookup could not see the
 * other.
 *
 * **The duplicate firing is rejected by state rather than by the clock**, which
 * is the same correction `closeRegistrationForCurrentSession` received earlier
 * and for the same reason — this one was simply missed at the time. It gated on
 * `isNearEasternTime(9, 0, 59)`, and GitHub has been firing the workflow about
 * five hours late every week (18:20Z and 18:58Z against a 13:00Z schedule, and
 * the same the week before). Five hours is far outside the 59-minute tolerance,
 * so **every firing was read as the seasonal duplicate and skipped**, returning
 * 200 — the workflow went green each Monday while registration never opened.
 *
 * Whether it is time is now asked of the session itself: `phaseOf` says whether
 * the registration window is open, honouring a session's own window where it
 * has one (ADR-0008). A late firing therefore does the right thing, and a
 * duplicate finds the work already done and does nothing.
 */
export async function openRegistrationForUpcomingSession(now: Date = new Date()): Promise<ScheduleRunResult> {
  return withMutationLock(async () => {
    const candidates = currentWeekGameDayCandidates(now);
    const defaultSessionId = candidates[0]; // Friday

    const existing = await getSessionsByIds(candidates);

    if (existing.length === 0) {
      // Deliberately does NOT create a default Friday session any more.
      //
      // It used to, as a safety net: whatever the organizer forgot, *something*
      // opened. That made sense while the week was a fixed Friday game. It does
      // not now that every session is created by hand, on any day, with its own
      // schedule — a row the app invents appears on every player's homepage as
      // a real game, which is worse than the gap it papers over.
      //
      // The protection is kept and the presumption dropped: the watchdog
      // reports `nothing-scheduled` off ordinary page traffic, so the organizer
      // finds out and decides. See weekWatchdog.missedJobsForWeek.
      return {
        results: [{ sessionId: defaultSessionId, skipped: true, reason: 'No session exists for this week — nothing to open.' }],
        changed: 0,
      };
    }

    const results: ScheduleResult[] = [];
    for (const session of existing) {
      // Already open, closed by hand, or cancelled — all of them mean there is
      // nothing here to do, and none should be re-stamped.
      if (session.status !== 'closed') {
        results.push({
          sessionId: session.sessionId,
          skipped: true,
          reason: `Registration is already ${session.status} — nothing to open.`,
        });
        continue;
      }

      // The idempotency guard, and so the thing that discards the duplicate
      // firing: a session is openable only while its own window says so.
      const phase = phaseOf(session, now);
      if (!isRegistrationOpen(phase)) {
        const { registrationOpensAt } = getWeeklyMilestones(session.gameDate, session.gameTime, session);
        results.push({
          sessionId: session.sessionId,
          skipped: true,
          reason:
            phase === 'before'
              ? `Registration does not open until ${formatEasternMoment(registrationOpensAt)}.`
              : `The registration window has already passed (${phase}).`,
        });
        continue;
      }

      // The stamp, not the setting. Until 2026-09-22 this wrote
      // registrationOpensAt, which is now when the organizer *wants* it to open
      // — writing the firing time there would move the session's schedule every
      // time the job ran, and a late cron would move it permanently late.
      await updateSession(session.sessionId, { status: 'open', registrationOpenedAt: now.toISOString() });
      results.push({ sessionId: session.sessionId, skipped: false });
    }

    return { results, changed: results.filter((r) => !r.skipped).length };
  });
}

/**
 * Tuesday 12am ET: close registration for the week's games.
 *
 * Acts on every session the week holds, for the same reason the open job does.
 *
 * Rejects the DST duplicate by state rather than by the clock, which it has
 * done since the week it ran without ever closing anything: GitHub fires the
 * workflow hours late, the old "is it within 30 minutes of midnight ET?" check
 * read that as the duplicate, and skipped — returning 200, so the workflow went
 * green while nothing happened. Widening the window cannot fix it either, since
 * the two firings are only an hour apart.
 *
 * So whichever firing arrives first closes the session, and any later one finds
 * it no longer 'open' and does nothing. That is correct no matter how late
 * either one lands, at the cost of one Sheets read on the duplicate firing.
 *
 * If capacity still has room once registration closes, the organizer gets
 * pushed an alert so an empty permit slot doesn't go unnoticed until game day —
 * same awaited-but-swallowed pattern as the other organizer alerts in
 * notifications.ts: a failed push shouldn't affect the close itself, which has
 * already succeeded by that point.
 */
export async function closeRegistrationForCurrentSession(now: Date = new Date()): Promise<ScheduleRunResult> {
  return withMutationLock(async () => {
    const candidates = currentWeekGameDayCandidates(now);

    const existing = await getSessionsByIds(candidates);
    if (existing.length === 0) {
      return {
        results: [{ sessionId: candidates[0], skipped: true, reason: 'No session exists for this week — nothing to close.' }],
        changed: 0,
      };
    }

    const results: ScheduleResult[] = [];
    for (const session of existing) {
      // The idempotency guard, and so the thing that discards the duplicate
      // firing: only an open session is closeable. Also covers the organizer
      // having closed or cancelled it by hand, which should likewise not
      // re-fire the alerts below.
      if (session.status !== 'open') {
        results.push({
          sessionId: session.sessionId,
          skipped: true,
          reason: `Registration is already ${session.status} — nothing to close.`,
        });
        continue;
      }

      // Derived from the session's own schedule rather than the clock, so an
      // early firing is rejected on the schedule it was meant to keep, not on
      // how close it happens to be to midnight.
      const { registrationClosesAt } = getWeeklyMilestones(session.gameDate, session.gameTime, session);
      if (!hasRegistrationClosed(phaseOf(session, now))) {
        results.push({
          sessionId: session.sessionId,
          skipped: true,
          reason: `Registration does not close until ${registrationClosesAt.toISOString()}.`,
        });
        continue;
      }

      await updateSession(session.sessionId, { status: 'closed', registrationClosedAt: now.toISOString() });
      results.push({ sessionId: session.sessionId, skipped: false });

      const signups = await listSignupsForSession(session.sessionId);
      const confirmed = countConfirmedSpots(signups);
      const openSpots = session.capacity - confirmed;

      // Always sent, unlike the open-spots alert below: the headcount is what
      // the organizer needs to decide whether to raise capacity and book a
      // second field, and that decision matters most precisely when the
      // session filled.
      await deliver(`headcount alert for session ${session.sessionId}`, () =>
        sendHeadcountAlert(session, confirmed, signups.filter((s) => s.status === 'waitlisted').length)
      );

      if (openSpots > 0) {
        await deliver(`open-spots alert for session ${session.sessionId}`, () => sendOpenSpotsAlert(session, openSpots));
      }
    }

    return { results, changed: results.filter((r) => !r.skipped).length };
  });
}

/**
 * Game-day reminder to everyone confirmed: when, where, and what they owe.
 *
 * This was the app's first *bulk* send, which drove two decisions:
 *
 * 1. **It runs from the cron, not a request handler.** ~20 sequential Gmail
 *    calls is ~10s of wall clock, uncomfortably close to serverless function
 *    limits. GitHub Actions has a far more generous time budget. The
 *    admin-triggered announcements in announcements.ts are the deliberate
 *    exception — they exist to be pressed by a person watching for the
 *    result, so they pay that cost in a request and raise `maxDuration` to
 *    cover it.
 * 2. **Sends are sequential with a small gap.** The Gmail API costs ~100 quota
 *    units per send against ~250 units/user/second, so a Promise.all burst
 *    would trip the rate limit. Volume is not the constraint — ~20 emails a
 *    week against a ~500/day sending limit is under 5% of one day's
 *    allowance — the burst rate is.
 *
 * One failure never aborts the rest: same awaited-but-swallowed pattern as
 * every other notification here.
 *
 * Exported because that second point is a property of the Gmail account, not
 * of this job: every bulk send in the app has to pace itself the same way, and
 * a second copy of the number would be a second thing to get wrong.
 */
export const SEND_GAP_MS = 500;

export interface ReminderResult {
  sessionId: string;
  skipped: boolean;
  reason?: string;
  sent?: number;
  failed?: number;
}

/**
 * The game-day email, sent by the organizer from the dashboard.
 *
 * Gated on the roster lock rather than on a clock time. That is not a
 * convenience: until the lock, a cancellation can still change who is playing,
 * so the cost share is not final and the email cannot state what someone owes
 * without hedging. Once the lock has passed it can, whatever the hour — which
 * is what lets an early game lock the evening before and send then (ADR-0006).
 *
 * Deliberately NOT gated on the game being today, which is what the cron
 * version checked. A session that locks the night before is sent the night
 * before, and `sendGameDayReminderEmail` words itself relative to `now`.
 */
export async function sendRemindersForSession(sessionId: string, now: Date = new Date()): Promise<ReminderResult> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');
    if (session.status === 'cancelled') {
      throw new ApiError(409, 'This game is cancelled, so there is nothing to remind anyone about.');
    }

    const phase = phaseOf(session, now);
    if (!isRosterLocked(phase)) {
      throw new ApiError(
        409,
        `The roster has not locked yet. It locks ${formatEasternMoment(paymentOpensAt(session))}, and the email says what each player owes, which is not final until then.`
      );
    }
    if (hasGameStarted(phase)) {
      throw new ApiError(409, 'The game has already started.');
    }

    const signups = await listSignupsForSession(sessionId);
    const confirmed = signups.filter((s) => s.status === 'confirmed');
    if (confirmed.length === 0) {
      return { sessionId, skipped: true, reason: 'Nobody is confirmed.' };
    }

    const owed = computeCostShare(session, signups);
    // Decides whether the email closes with the nudge to cancel: that line
    // only makes sense while somebody is actually waiting for a spot.
    const hasWaitlist = signups.some((s) => s.status === 'waitlisted');

    let sent = 0;
    let failed = 0;
    for (const signup of confirmed) {
      // `now` is threaded through so "today" versus "tomorrow" is decided by
      // the same clock the send is running against, not wall time.
      if (
        await deliver(`game-day email to ${signup.email}`, () =>
          sendGameDayReminderEmail(signup, session, owed[signup.signupId] ?? 0, hasWaitlist, now)
        )
      ) {
        sent += 1;
      } else {
        failed += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }

    // Only on a send that reached somebody. A run that failed for all of them
    // should leave the dashboard saying the email still has to go out.
    if (sent > 0) await updateSession(sessionId, { remindersSentAt: now.toISOString() });

    return { sessionId, skipped: false, sent, failed };
  });
}
