import { getSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession } from '../sheets/signups';
import { formatEasternMoment } from './time';
import { phaseOf, isRosterLocked, hasGameStarted } from './sessionPhase';
import { computeCostShare, paymentOpensAt } from './payments';
import { ApiError } from './apiErrors';
import { sendGameDayReminderEmail, deliver } from './notifications';
import { withMutationLock } from './lock';

export const DEFAULT_GAME_TIME = process.env.SESSION_DEFAULT_GAME_TIME || '18:00';
export const DEFAULT_CAPACITY = Number(process.env.SESSION_DEFAULT_CAPACITY) || 20;
// What one spot costs a player. Fixed rather than derived from the permit
// total so the number is stable and knowable at signup time — see
export const DEFAULT_PRICE_PER_SPOT = Number(process.env.SESSION_DEFAULT_PRICE_PER_SPOT) || 0;

/**
 * Game-day reminder to everyone confirmed: when, where, and what they owe.
 *
 * This was the app's first *bulk* send. It ran from a GitHub Actions cron at
 * first, for the longer time budget, and moved to a dashboard button once the
 * crons proved unreliable; the route raises `maxDuration` to cover ~20
 * sequential Gmail calls.
 *
 * **Sends are sequential with a small gap.** The Gmail API costs ~100 quota
 * units per send against ~250 units/user/second, so a Promise.all burst would
 * trip the rate limit. Volume is not the constraint — ~20 emails a week against
 * a ~500/day sending limit is under 5% of one day's allowance — the burst rate
 * is.
 *
 * One failure never aborts the rest: same awaited-but-swallowed pattern as
 * every other notification here.
 *
 * Exported because the gap is a property of the Gmail account, not
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
