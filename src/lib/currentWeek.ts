import { Session } from '../sheets/schema';
import { deliver } from './notifications';
import { getSessionByAnyId } from '../sheets/sessions';
import { currentWeekGameDayCandidates } from './time';
import { reportMissedJobs } from './weekWatchdog';

/**
 * This week's session, for the two routes that show it to anyone.
 *
 * `/api/home` and `/api/sessions/current` are unauthenticated and each does a
 * live Sheets read. All Sheets traffic is attributed to one service account,
 * so the binding quota is **60 reads per minute for the whole app** — which a
 * `curl` loop at two requests a second exhausts, with no login and no cost,
 * and which registration opening at a fixed weekly time can exhaust honestly.
 * Either way nobody can sign up.
 *
 * So the read is cached, and — more importantly for the Monday rush —
 * concurrent misses are collapsed onto **one** in-flight read rather than
 * each starting their own. Twenty people refreshing at 9am cost one read
 * instead of twenty.
 *
 * Read paths only. Every mutation still reads the session directly, because a
 * capacity check against a stale row is how a roster oversubscribes.
 */

/** A session found is stable for half a minute: the organizer edits it rarely,
 * and a stale location for that long is a smaller cost than an exhausted
 * quota. */
const FOUND_TTL_MS = 30_000;

/**
 * A *missing* session is cached far more briefly, because "there is no game
 * this week" is precisely the answer about to change — the cron creates the
 * week at 9am Monday and players are watching for it. Long enough to blunt a
 * flood, short enough that nobody is told there is no game once there is.
 */
const MISSING_TTL_MS = 5_000;

let entry: { until: number; read: Promise<Session | null> } | null = null;

/** This week's session, possibly from cache. */
export async function currentWeekSession(now: number = Date.now()): Promise<Session | null> {
  if (entry && now < entry.until) return entry.read;

  // Held as the promise, not the result, so callers arriving mid-read join it.
  // Pessimistic until it resolves: a read that turns out to be a miss shortens
  // its own window below.
  const read = getSessionByAnyId(currentWeekGameDayCandidates());
  const mine = { until: now + FOUND_TTL_MS, read };
  entry = mine;

  try {
    const session = await read;
    if (!session && entry === mine) mine.until = now + MISSING_TTL_MS;

    // Off the read, not off a schedule: the jobs this watches are GitHub
    // `schedule` triggers, and a watchdog on a schedule of its own would be
    // disabled by the same 60-day rule that disabled them. Costs nothing when
    // the week is on track — the check is pure and only reaches Redis once it
    // has something to report — and it is swallowed, because a watchdog that
    // can fail a player's page load is worse than the problem it reports.
    await deliver('week watchdog', () => reportMissedJobs(session, new Date(now)));

    return session;
  } catch (err) {
    // A failed read must not be served to everyone for the next 30 seconds.
    if (entry === mine) entry = null;
    throw err;
  }
}

/**
 * Drops the cached week. For tests, which need each case to start cold.
 *
 * There is deliberately no invalidation hook on the session writes. This runs
 * serverless: the instance that writes is rarely the instance that serves, so
 * a hook would clear one process's copy and leave every other one stale —
 * which is a guarantee that looks real and is not. The TTLs above are the
 * whole guarantee, and they are short because of it.
 */
export function forgetCurrentWeek(): void {
  entry = null;
}
