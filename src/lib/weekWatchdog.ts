import { Session } from '../sheets/schema';
import { getRedis } from './redis';
import { sendPush } from './ntfy';
import { deliver } from './notifications';
import { currentWeekGameDayCandidates, getWeeklyMilestones, formatEasternMoment, formatGameDate } from './time';
import { DEFAULT_GAME_TIME } from './scheduling';

/**
 * Noticing that a scheduled job never ran.
 *
 * Four operational jobs run as GitHub Actions `schedule` triggers, and GitHub
 * **disables those on a repository with no commits for 60 days**. A cron that
 * *fails* emails the last committer. A cron that never *fires* surfaces
 * nowhere at all — and the worst case is `open-registration`: Monday comes,
 * registration silently never opens, and the first signal is a player asking
 * why they cannot sign up.
 *
 * A watchdog on a schedule of its own would be disabled by the same rule that
 * disabled what it watches, so this is not on a schedule. It runs on ordinary
 * web traffic, off the same read the homepage already makes, and asks a
 * question the app can answer from state it already has: *given the time, does
 * this week look like the jobs ran?*
 *
 * That it needs a visitor is a real limitation and an acceptable one: the
 * failure that matters most is the one where people are arriving to sign up
 * and cannot. Nobody visiting all Monday morning is a different problem.
 *
 * `sendGameDayReminders` is deliberately absent. It leaves no trace in the
 * sheet, so there is nothing here to check it by — knowing that is better than
 * a check that looks like coverage and is not.
 */

/**
 * How late a job may be before this counts it missed.
 *
 * GitHub's scheduled runs are routinely delayed under load, and
 * `open-registration` itself tolerates being up to 59 minutes off its hour. Two
 * hours is comfortably past both, and still leaves most of a Monday morning to
 * fix it by hand.
 */
const GRACE_MS = 2 * 60 * 60 * 1000;

/** How long one alert suppresses the next for the same week and job. Long
 * enough that a busy Monday sends one push rather than a hundred, short enough
 * that an unfixed problem asks again the next morning. */
const REPEAT_AFTER_SECONDS = 12 * 60 * 60;

export interface MissedJob {
  /** The workflow that should have done this, so the alert names it. */
  job: 'open-registration' | 'close-registration' | 'generate-teams';
  message: string;
  /** Whether a player is blocked right now, as opposed to the organizer
   * being short of information. */
  urgent: boolean;
}

/**
 * Which jobs look like they never ran, given the clock and what is in the sheet.
 *
 * Pure, and free: no I/O, so the read path can ask on every cache miss and pay
 * nothing in the overwhelmingly common case where the answer is "none".
 *
 * Each check is written against the *observable consequence* of a job, not
 * against whether it was invoked — nothing records that. So these hold equally
 * when the workflow was disabled, when it fired and errored, and when the
 * endpoint returned 200 having quietly done nothing, which is the case a
 * dead-man's-switch ping would miss.
 */
export function missedJobsFor(session: Session | null, now: Date = new Date()): MissedJob[] {
  const expectedGameDate = currentWeekGameDayCandidates(now)[0];
  const missed: MissedJob[] = [];

  // With no session at all, the schedule can only be read off the week the
  // default Friday would have had.
  const milestones = getWeeklyMilestones(session?.gameDate ?? expectedGameDate, session?.gameTime ?? DEFAULT_GAME_TIME);
  const overdue = (at: Date) => now.getTime() > at.getTime() + GRACE_MS;

  // A cancelled week is a decision, not a failure: no job should have run.
  if (session?.status === 'cancelled') return missed;

  if (overdue(milestones.registrationOpensAt)) {
    if (!session) {
      missed.push({
        job: 'open-registration',
        message: `Nobody can sign up: no game exists for ${formatGameDate(expectedGameDate)}. Registration should have opened ${formatEasternMoment(milestones.registrationOpensAt)}.`,
        urgent: true,
      });
    } else if (session.status === 'closed' && now < milestones.registrationClosesAt) {
      // Windowed on purpose. A blank status row parses as 'closed', and
      // 'closed' is the *correct* state once the window has passed — so this
      // only means a missed job while the week is one people should be able
      // to sign up for right now.
      missed.push({
        job: 'open-registration',
        message: `Nobody can sign up: ${formatGameDate(session.gameDate)} is still closed. Registration should have opened ${formatEasternMoment(milestones.registrationOpensAt)} and does not close until ${formatEasternMoment(milestones.registrationClosesAt)}.`,
        urgent: true,
      });
    }
  }

  // Only that the *alerts* never went out: the signup gate is derived from the
  // clock, so a session left "open" past its window still refuses signups. The
  // organizer just never got the headcount they book a permit from.
  if (session && session.status === 'open' && overdue(milestones.registrationClosesAt)) {
    missed.push({
      job: 'close-registration',
      message: `No headcount was sent for ${formatGameDate(session.gameDate)}. It is still marked open past ${formatEasternMoment(milestones.registrationClosesAt)}.`,
      urgent: false,
    });
  }

  if (session && session.teamsStatus === '' && overdue(milestones.cutoffStart)) {
    missed.push({
      job: 'generate-teams',
      message: `No teams for ${formatGameDate(session.gameDate)}. The roster locked ${formatEasternMoment(milestones.cutoffStart)}.`,
      urgent: false,
    });
  }

  return missed;
}

/**
 * Whether this is the first report of `key` in the repeat window.
 *
 * Without Redis there is no shared memory, so it reports — once per instance
 * per cold start, which is noisier than intended but not silent. Silence is
 * the failure mode this whole module exists to remove, so that is the right
 * way to degrade.
 */
async function shouldReport(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return !reportedThisProcess.has(key);

  const claimed = await redis.set(`watchdog:${key}`, '1', { nx: true, ex: REPEAT_AFTER_SECONDS });
  return claimed === 'OK';
}

const reportedThisProcess = new Set<string>();

/**
 * Pushes one alert per missed job to the organizer's phone.
 *
 * Awaited but swallowed, like every other alert in this app: this runs off a
 * page load, and a watchdog that can fail a player's request is worse than the
 * problem it reports.
 */
export async function reportMissedJobs(session: Session | null, now: Date = new Date()): Promise<void> {
  const missed = missedJobsFor(session, now);
  if (missed.length === 0) return;

  const week = session?.sessionId ?? currentWeekGameDayCandidates(now)[0];

  for (const { job, message, urgent } of missed) {
    const key = `${week}:${job}`;
    if (!(await shouldReport(key))) continue;
    reportedThisProcess.add(key);

    await deliver(`watchdog alert for ${key}`, () =>
      sendPush(`Scheduled job did not run: ${job}`, `${message}\n\nRun the workflow by hand from the repository's Actions tab.`, {
        priority: urgent ? 5 : 4,
        tags: [urgent ? 'rotating_light' : 'warning'],
      })
    );
  }
}

/** For tests, which need each case to start with nothing remembered. */
export function forgetWatchdogReports(): void {
  reportedThisProcess.clear();
}
