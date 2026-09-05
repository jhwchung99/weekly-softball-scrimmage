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

const PROMOTION_CUTOFF_HOURS = 2;

/** Section 6: no auto-promotion within 2 hours of game time. */
export function isWithinPromotionCutoff(gameDate: string, gameTime: string, now: Date = new Date()): boolean {
  const gameStart = zonedTimeToUtc(gameDate, gameTime);
  const cutoffStart = new Date(gameStart.getTime() - PROMOTION_CUTOFF_HOURS * 60 * 60 * 1000);
  return now >= cutoffStart;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export interface WeeklyMilestones {
  /** Monday 9am ET — when registration is scheduled to open. */
  registrationOpensAt: Date;
  /** Wednesday 9pm ET — when registration is scheduled to close. */
  registrationClosesAt: Date;
  /** The game's actual start instant. */
  gameStart: Date;
  /** 2 hours before gameStart — see isWithinPromotionCutoff. */
  cutoffStart: Date;
}

/**
 * The four dates a player might want to see on a weekly timeline,
 * derived purely from the game date/time — not from the session's own
 * registrationOpensAt/registrationClosesAt fields, which are often
 * blank (closesAt stays '' until the Wednesday cron actually runs) or
 * reflect an admin manually opening things early rather than the
 * intended schedule. This computes the *schedule*, independent of
 * whether it's actually been hit yet — pairs with the session's own
 * `status` field (the actual source of truth for whether signups are
 * currently accepted) rather than replacing it. No server-only APIs
 * used, safe to import from a client component too.
 *
 * Game day can be Friday, Saturday, or Sunday (validateGameDate
 * enforces this) — registration always opens the Monday and closes the
 * Wednesday of that same calendar week, regardless of which of the
 * three days the game itself falls on.
 */
export function getWeeklyMilestones(gameDate: string, gameTime: string): WeeklyMilestones {
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
  const wednesdayNoonUtc = mondayNoonUtc + 2 * 24 * 60 * 60 * 1000;

  const registrationOpensAt = zonedTimeToUtc(toDateStr(mondayNoonUtc), '09:00');
  const registrationClosesAt = zonedTimeToUtc(toDateStr(wednesdayNoonUtc), '21:00');
  const gameStart = zonedTimeToUtc(gameDate, gameTime);
  const cutoffStart = new Date(gameStart.getTime() - PROMOTION_CUTOFF_HOURS * 60 * 60 * 1000);

  return { registrationOpensAt, registrationClosesAt, gameStart, cutoffStart };
}

/**
 * The Friday of the calendar week `now` falls in, as read in Eastern
 * time — this is what makes "today" mean the right thing for a
 * Monday/Wednesday cron job regardless of what timezone the server
 * itself happens to run in (e.g. Vercel/GitHub Actions runners are UTC).
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

/**
 * The Friday, Saturday, and Sunday of the calendar week `now` falls in
 * (Eastern time), in that order. Game day can be any of the three (see
 * getWeeklyMilestones), so "this week's session" is a 3-way id lookup —
 * whichever of these actually has a row — rather than the single fixed
 * key a Friday-only schedule would allow. Built on top of
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
 * True if `now`, read in Eastern time, is within `toleranceMinutes` of
 * `targetHour:targetMinute`. Needed because GitHub Actions cron schedules
 * are fixed UTC and don't shift for DST — a cron job meant to fire at a
 * fixed Eastern wall-clock time has to be scheduled at BOTH possible UTC
 * offsets, and the endpoint itself decides which firing is the real one
 * versus the seasonal duplicate to discard.
 */
export function isNearEasternTime(
  targetHour: number,
  targetMinute: number,
  toleranceMinutes: number,
  now: Date = new Date(),
  timeZone: string = LEAGUE_TIME_ZONE
): boolean {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(dtf.formatToParts(now).map((p) => [p.type, p.value]));
  const nowMinutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const targetMinutes = targetHour * 60 + targetMinute;
  return Math.abs(nowMinutes - targetMinutes) <= toleranceMinutes;
}
