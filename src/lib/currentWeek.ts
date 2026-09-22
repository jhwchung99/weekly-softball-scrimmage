import { Session } from '../sheets/schema';
import { deliver } from './notifications';
import { listSessions } from '../sheets/sessions';
import { todayEastern } from './time';
import { reportMissedJobs } from './weekWatchdog';

/**
 * The sessions still to come, for the routes that show them to anyone.
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
 *
 * This returned a single `Session | null` until 2026-09-22, found by taking
 * the first of `[Friday, Saturday, Sunday]` that had a row — which is why a
 * week could only ever show one game. It returns the list now, and the cost is
 * unchanged: it was always one whole-tab read, and filtering it in memory is
 * free.
 */

/** Sessions found are stable for half a minute: the organizer edits them
 * rarely, and a stale location for that long is a smaller cost than an
 * exhausted quota. */
const FOUND_TTL_MS = 30_000;

/**
 * An *empty* list is cached far more briefly, because "there is nothing
 * scheduled" is precisely the answer about to change — and players are
 * watching for it. Long enough to blunt a flood, short enough that nobody is
 * told there is no game once there is.
 */
const EMPTY_TTL_MS = 5_000;

let entry: { until: number; read: Promise<Session[]> } | null = null;

/**
 * Every session whose game date has not passed, soonest first.
 *
 * "Not passed" is by date rather than by kickoff, so a game today stays listed
 * all day — the roster, the teams and what someone owes are all still wanted
 * after the last out.
 *
 * No horizon. However many sessions exist ahead is however many are returned:
 * a cap would be machinery guarding a case that does not arise, and one that
 * silently hid a session the organizer had created would be the same class of
 * bug as Friday silently beating Sunday.
 */
async function readUpcoming(now: number): Promise<Session[]> {
  const today = todayEastern(new Date(now));
  const sessions = await listSessions();

  return sessions
    .filter((s) => s.gameDate >= today)
    // ISO dates and 24-hour times both sort lexicographically, so this is the
    // chronological order without parsing either of them.
    .sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.gameTime.localeCompare(b.gameTime));
}

/** The upcoming sessions, possibly from cache. */
export async function upcomingSessions(now: number = Date.now()): Promise<Session[]> {
  if (entry && now < entry.until) return entry.read;

  // Held as the promise, not the result, so callers arriving mid-read join it.
  // Optimistic until it resolves: a read that turns out to be empty shortens
  // its own window below.
  const read = readUpcoming(now);
  const mine = { until: now + FOUND_TTL_MS, read };
  entry = mine;

  try {
    const sessions = await read;
    if (sessions.length === 0 && entry === mine) mine.until = now + EMPTY_TTL_MS;

    // Off the read, not off a schedule: the jobs this watches are GitHub
    // `schedule` triggers, and a watchdog on a schedule of its own would be
    // disabled by the same 60-day rule that disabled them. Costs nothing when
    // the week is on track — the check is pure and only reaches Redis once it
    // has something to report — and it is swallowed, because a watchdog that
    // can fail a player's page load is worse than the problem it reports.
    //
    // Given the whole list: each session has its own lock, its own teams and
    // its own email to forget, and an empty list is itself worth reporting.
    await deliver('week watchdog', () => reportMissedJobs(sessions, new Date(now)));

    return sessions;
  } catch (err) {
    // A failed read must not be served to everyone for the next 30 seconds.
    if (entry === mine) entry = null;
    throw err;
  }
}

/**
 * Drops the cached list. For tests, which need each case to start cold.
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
