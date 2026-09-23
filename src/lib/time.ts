const LEAGUE_TIME_ZONE = 'America/New_York';

/**
 * Converts a wall-clock date+time as it would read in `timeZone` (e.g.
 * "6:00 PM Eastern") into the actual UTC instant it represents — correct
 * across the EST/EDT boundary, using only the built-in Intl API (no
 * tz-database dependency needed).
 *
 * Technique: treat the wall-clock numbers as if they were UTC (a
 * meaningless but useful anchor instant), format that anchor in the
 * target zone to see how far its clock reading differs from the anchor's
 * own numbers, then shift the anchor by that difference.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string = LEAGUE_TIME_ZONE): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const anchor = Date.UTC(year, month - 1, day, hour, minute, 0);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(anchor));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl can format the hour as "24" for midnight instead of "00" — normalize.
  const anchorViewedInZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));

  const offsetMs = anchorViewedInZone - anchor;
  return new Date(anchor - offsetMs);
}

/** Section 6: no auto-promotion within 5 hours of game time. Consumed via
 * `cutoffStart` below — asking whether a session is past it is
 * `sessionPhase.isRosterLocked`, which is the only place that compares a
 * milestone to the clock. */
const PROMOTION_CUTOFF_HOURS = 5;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A session's own schedule, where it overrides the derived default.
 *
 * Every field is optional and blank means "use the default", exactly as
 * `rosterLockAt` has always worked (ADR-0006). A `Session` satisfies this
 * structurally, so a caller holding one passes it straight through rather
 * than picking fields out of it.
 */
export interface ScheduleOverrides {
  /** When this session's roster locks. '' = five hours before the game. */
  rosterLockAt?: string;
  /** When registration opens. '' = 9am ET the Monday of the game's week. */
  registrationOpensAt?: string;
  /** When registration closes. '' = 12am ET that Tuesday. */
  registrationClosesAt?: string;
}

/** An override that parses, or null so the caller falls back. An unreadable
 * value is deliberately not an error: a hand-edited cell should not be able to
 * take a session's whole schedule out. */
function parsedOverride(value: string | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export interface WeeklyMilestones {
  /** When registration opens: the session's own `registrationOpensAt` if it
   * has one, otherwise 9am ET on the Monday of the game's week. */
  registrationOpensAt: Date;
  /** When registration closes: the session's own `registrationClosesAt` if it
   * has one, otherwise 12am ET that Tuesday. The default is deliberately
   * short (~15 hours), giving the organizer the rest of the week to book a
   * permit sized to the actual headcount. */
  registrationClosesAt: Date;
  /** The game's actual start instant. */
  gameStart: Date;
  /** When the roster locks: the session's own `rosterLockAt` if it has one,
   * otherwise 5 hours before gameStart. */
  cutoffStart: Date;
}

/**
 * The four dates a player might want to see on a weekly timeline: what the
 * schedule *intends*, independent of whether it has been hit yet.
 *
 * Each one is the session's own value where it has one and a value derived
 * from the game date where it does not. Until 2026-09-22 only the lock could
 * be overridden and the window was always derived — the session's
 * `registrationOpensAt`/`registrationClosesAt` columns existed but held
 * timestamps of when the crons ran, so this deliberately ignored them. Those
 * columns are now the settings their names always claimed to be, and the
 * stamps moved to `registrationOpenedAt`/`registrationClosedAt`.
 *
 * Pairs with the session's own `status` field rather than replacing it. Since
 * 2026-09-07 the signup gate requires BOTH (see signupFlow's
 * requireOpenSessionAndProfile): status alone was a single point of failure,
 * because anything that set a session open accepted signups immediately,
 * whatever the calendar said. No server-only APIs used, safe to import from a
 * client component too.
 *
 * Game day can be any day of the week. The *derived* window always opens the
 * Monday and closes the Tuesday of the game's own calendar week, whichever day
 * the game falls on — which is coherent for every weekday except Monday, where
 * it would close after the game has been played. A Monday game therefore has
 * to carry its own window; `assertScheduleOrdering` in adminFlow is what
 * refuses to save one that does not, and the same check catches a hand-typed
 * window in the wrong order on any other day.
 */
export function getWeeklyMilestones(
  gameDate: string,
  gameTime: string,
  overrides: ScheduleOverrides = {}
): WeeklyMilestones {
  const [year, month, day] = gameDate.split('-').map(Number);
  // Anchored at noon UTC so subtracting whole days never crosses a
  // local-date boundary before the zone conversion happens below.
  const gameNoonUtc = Date.UTC(year, month - 1, day, 12);
  const toDateStr = (utcMs: number) => {
    const d = new Date(utcMs);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const isoWeekday = new Date(gameNoonUtc).getUTCDay() || 7; // Mon=1..Sun=7
  const daysSinceMonday = isoWeekday - 1; // Fri=4, Sat=5, Sun=6
  const mondayNoonUtc = gameNoonUtc - daysSinceMonday * 24 * 60 * 60 * 1000;
  const tuesdayNoonUtc = mondayNoonUtc + 1 * 24 * 60 * 60 * 1000;

  // Each milestone is the session's own value where it has one, and the
  // derived default where it does not — the ADR-0006 pattern, now covering the
  // whole window rather than the lock alone. This stays the only place the
  // arithmetic happens, so every consumer follows an override without knowing
  // it exists.
  const registrationOpensAt =
    parsedOverride(overrides.registrationOpensAt) ?? zonedTimeToUtc(toDateStr(mondayNoonUtc), '09:00');
  const registrationClosesAt =
    parsedOverride(overrides.registrationClosesAt) ?? zonedTimeToUtc(toDateStr(tuesdayNoonUtc), '00:00');
  const gameStart = zonedTimeToUtc(gameDate, gameTime);
  const cutoffStart =
    parsedOverride(overrides.rosterLockAt) ??
    new Date(gameStart.getTime() - PROMOTION_CUTOFF_HOURS * 60 * 60 * 1000);

  return { registrationOpensAt, registrationClosesAt, gameStart, cutoffStart };
}

/**
 * The Friday of the calendar week `now` falls in, as read in Eastern
 * time, so "this week" means the league's week whatever timezone the
 * server runs in (Vercel is UTC).
 * Weekday arithmetic on a Y/M/D triple is timezone-independent once the
 * triple itself is correctly the Eastern one, so a plain local Date is
 * safe to use here — it's never treated as an instant.
 */
export function currentWeekFridayEastern(now: Date = new Date(), timeZone: string = LEAGUE_TIME_ZONE): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(now).map((p) => [p.type, p.value]));
  const d = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const daysUntilFriday = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + daysUntilFriday);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The coming Monday in Eastern time, YYYY-MM-DD, which is where "this week"
 * stops. Never today: on a Monday it is the Monday after. */
export function nextMondayEastern(now: Date = new Date(), timeZone: string = LEAGUE_TIME_ZONE): string {
  const [year, month, day] = todayEastern(now, timeZone).split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day, 12));
  // getUTCDay: 0 = Sunday. Days until the next Monday, never 0.
  today.setUTCDate(today.getUTCDate() + ((8 - (today.getUTCDay() || 7)) % 7 || 7));
  return today.toISOString().slice(0, 10);
}

/** Today's date as read in Eastern time, YYYY-MM-DD. */
export function todayEastern(now: Date = new Date(), timeZone: string = LEAGUE_TIME_ZONE): string {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The Friday, Saturday, and Sunday of the calendar week `now` falls in
 * (Eastern time), in that order. Game day can now be any weekday, so this no
 * longer finds a week's sessions; the watchdog uses the Friday only as the
 * reference week for "nothing is scheduled". Built on top of
 * currentWeekFridayEastern rather than re-deriving the Eastern-timezone
 * weekday math a second time.
 */
export function currentWeekGameDayCandidates(now: Date = new Date(), timeZone: string = LEAGUE_TIME_ZONE): string[] {
  const friday = currentWeekFridayEastern(now, timeZone);
  const [year, month, day] = friday.split('-').map(Number);
  const fridayNoonUtc = Date.UTC(year, month - 1, day, 12);
  return [0, 1, 2].map((offset) => {
    const d = new Date(fridayNoonUtc + offset * 24 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
}

/**
 * A game's date as a player should read it: "Friday, July 10".
 *
 * The sheet stores `2026-07-10` and that is the right shape for an id — it
 * sorts, it is unambiguous across locales, and it *is* the session's key. It
 * is the wrong shape for a sentence. Nobody converts an ISO date in their head
 * on a Tuesday, and a date written that way in an email is the single loudest
 * signal that software wrote it.
 *
 * Formatted from the date parts directly rather than through a `Date`, because
 * a bare `new Date('2026-07-10')` is parsed as UTC midnight and renders as the
 * 9th in every North American zone. That off-by-one would be invisible in
 * review and wrong in every email.
 */
export function formatGameDate(gameDate: string): string {
  const [year, month, day] = gameDate.split('-').map(Number);
  // Noon UTC: far enough from either midnight that no zone shifts the date.
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(noonUtc);
}

/**
 * A game's start time as a player should read it: "6pm", or "6:30pm".
 *
 * No minutes when they are zero, and lower-case, because that is how someone
 * writes a time to a friend. The stored `18:00` is a 24-hour string a North
 * American church league does not speak.
 */
export function formatGameTime(gameTime: string): string {
  const [hour, minute] = gameTime.split(':').map(Number);
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;

  return minute === 0 ? `${twelve}${suffix}` : `${twelve}:${String(minute).padStart(2, '0')}${suffix}`;
}

/**
 * A clock time in league time, spelled the way `formatGameTime` spells one:
 * "2pm", not "2:00 PM".
 *
 * Exists because the payment sentence quotes the roster lock two lines from a
 * sentence quoting the game time, and a raw toLocaleString put both spellings
 * in one email (voice.md rule 11).
 */
export function formatEasternClockTime(at: Date, timeZone: string = LEAGUE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return formatGameTime(`${get('hour')}:${get('minute')}`);
}

/**
 * "today" or "tomorrow", for an email that may be sent on either day.
 *
 * The game-day email used to be able to assume "today", because a cron sent it
 * and refused to run on any other date. The organizer sends it now, and a
 * session that locks the night before is sent the night before — so the phrase
 * has to be worked out rather than assumed. Anything further out than tomorrow
 * gets the full date, which should not happen (the send is gated on the lock)
 * but is the right thing to say if it ever does.
 */
export function relativeGameDay(
  session: { gameDate: string; gameTime: string },
  now: Date = new Date(),
  timeZone: string = LEAGUE_TIME_ZONE
): string {
  const today = todayEastern(now, timeZone);
  if (session.gameDate === today) return 'today';

  const [y, m, d] = today.split('-').map(Number);
  const tomorrowNoonUtc = Date.UTC(y, m - 1, d, 12) + 24 * 60 * 60 * 1000;
  const t = new Date(tomorrowNoonUtc);
  const tomorrow = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  if (session.gameDate === tomorrow) return 'tomorrow';

  return formatGameDate(session.gameDate);
}

/** "Friday, July 10 at 6pm" — how every player-facing mention of a game reads. */
export function formatGameDay(gameDate: string, gameTime: string): string {
  return `${formatGameDate(gameDate)} at ${formatGameTime(gameTime)}`;
}

/**
 * A moment in league time, as a person would say it: "Monday, September 14 at 9am".
 *
 * For the times the app has to name that are not a game's start — when
 * registration opens, when it closed, when a job should have run. Same shape
 * as `formatGameDay` on purpose: one way of writing a date and time, so the
 * app does not speak three dialects.
 *
 * Always Eastern, never the server's zone, and never the reader's. The league
 * runs on one clock and every milestone in `getWeeklyMilestones` is computed
 * against it.
 */
export function formatEasternMoment(at: Date, timeZone: string = LEAGUE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('month')} ${get('day')} at ${formatGameTime(`${get('hour')}:${get('minute')}`)}`;
}
