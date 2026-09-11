import { describe, it, expect } from 'vitest';
import { zonedTimeToUtc, currentWeekFridayEastern, currentWeekGameDayCandidates, isNearEasternTime, getWeeklyMilestones, formatGameDate, formatGameTime, formatGameDay, formatEasternMoment } from '../time';

describe('zonedTimeToUtc', () => {
  it('converts an EDT (summer) wall-clock time to the correct UTC instant', () => {
    // 6:00 PM EDT (UTC-4) on 2026-07-10 = 22:00 UTC.
    const result = zonedTimeToUtc('2026-07-10', '18:00');
    expect(result.toISOString()).toBe('2026-07-10T22:00:00.000Z');
  });

  it('converts an EST (winter) wall-clock time to the correct UTC instant', () => {
    // 6:00 PM EST (UTC-5) on 2026-01-10 = 23:00 UTC.
    const result = zonedTimeToUtc('2026-01-10', '18:00');
    expect(result.toISOString()).toBe('2026-01-10T23:00:00.000Z');
  });
});

describe('currentWeekFridayEastern', () => {
  it('returns the same date when today already is Friday', () => {
    // 2026-07-10 is a Friday. Use noon UTC to stay clear of the date
    // boundary in either EDT or EST.
    expect(currentWeekFridayEastern(new Date('2026-07-10T12:00:00.000Z'))).toBe('2026-07-10');
  });

  it('returns the upcoming Friday when today is Monday', () => {
    // 2026-07-06 is a Monday.
    expect(currentWeekFridayEastern(new Date('2026-07-06T12:00:00.000Z'))).toBe('2026-07-10');
  });

  it('returns the upcoming Friday when today is Sunday (end of the week)', () => {
    // 2026-07-12 is a Sunday; the next Friday is 2026-07-17, not the one just passed.
    expect(currentWeekFridayEastern(new Date('2026-07-12T12:00:00.000Z'))).toBe('2026-07-17');
  });

  it('resolves correctly across a UTC date boundary near midnight Eastern', () => {
    // 2026-07-10T03:00:00Z is 2026-07-09T23:00:00 EDT (still Thursday
    // Eastern, even though the UTC calendar date is already Friday).
    expect(currentWeekFridayEastern(new Date('2026-07-10T03:00:00.000Z'))).toBe('2026-07-10');
  });
});

describe('isNearEasternTime', () => {
  it('is true exactly at the target time', () => {
    // 9:00 AM EDT = 13:00 UTC.
    expect(isNearEasternTime(9, 0, 30, new Date('2026-07-06T13:00:00.000Z'))).toBe(true);
  });

  it('is true within the tolerance window', () => {
    expect(isNearEasternTime(9, 0, 30, new Date('2026-07-06T13:29:00.000Z'))).toBe(true);
    expect(isNearEasternTime(9, 0, 30, new Date('2026-07-06T12:31:00.000Z'))).toBe(true);
  });

  it('is false outside the tolerance window', () => {
    expect(isNearEasternTime(9, 0, 30, new Date('2026-07-06T13:31:00.000Z'))).toBe(false);
  });

  it('rejects the DST-offset duplicate cron firing (1 hour off)', () => {
    // The whole point of this check: a firing exactly 1 hour off the
    // real target (the seasonal EST/EDT duplicate) must not pass with a
    // 30-minute tolerance.
    expect(isNearEasternTime(9, 0, 30, new Date('2026-07-06T14:00:00.000Z'))).toBe(false);
  });

  it('measures distance circularly around midnight', () => {
    // 11:45pm ET is 15 minutes from a midnight target, not 1,425. Plain
    // subtraction got this backwards and rejected everything just before
    // midnight — which was the entire pre-close window for the Tuesday job.
    expect(isNearEasternTime(0, 0, 30, new Date('2026-07-07T03:45:00.000Z'))).toBe(true);
    expect(isNearEasternTime(0, 0, 30, new Date('2026-07-07T04:15:00.000Z'))).toBe(true);
    // Still an hour off, so the seasonal duplicate stays rejected.
    expect(isNearEasternTime(0, 0, 30, new Date('2026-07-07T05:00:00.000Z'))).toBe(false);
  });
});

describe('getWeeklyMilestones', () => {
  // 2026-07-10 is a Friday, game at 18:00 EDT.
  const milestones = getWeeklyMilestones('2026-07-10', '18:00');

  it('computes registration opening as the preceding Monday 9am ET', () => {
    // 2026-07-06 is the Monday of that week; 9am EDT = 13:00 UTC.
    expect(milestones.registrationOpensAt.toISOString()).toBe('2026-07-06T13:00:00.000Z');
  });

  it('computes registration closing as the following Tuesday 12am ET', () => {
    // 2026-07-07 is the Tuesday of that week; 12am EDT = 04:00 UTC same day.
    expect(milestones.registrationClosesAt.toISOString()).toBe('2026-07-07T04:00:00.000Z');
  });

  it('computes game start from gameDate/gameTime directly', () => {
    expect(milestones.gameStart.toISOString()).toBe('2026-07-10T22:00:00.000Z');
  });

  it('computes the cutoff as exactly 5 hours before game start', () => {
    expect(milestones.cutoffStart.toISOString()).toBe('2026-07-10T17:00:00.000Z');
  });

  it('holds up across the EST/EDT boundary (winter game date)', () => {
    // 2026-01-09 is a Friday in EST (winter).
    const winter = getWeeklyMilestones('2026-01-09', '18:00');
    // Monday 2026-01-05, 9am EST = 14:00 UTC.
    expect(winter.registrationOpensAt.toISOString()).toBe('2026-01-05T14:00:00.000Z');
    // Tuesday 2026-01-06, 12am EST = 05:00 UTC same day.
    expect(winter.registrationClosesAt.toISOString()).toBe('2026-01-06T05:00:00.000Z');
  });

  it('anchors registration to the same Monday/Tuesday for a Saturday game', () => {
    // 2026-07-11 is the Saturday of the same week as 2026-07-10's Friday.
    const saturday = getWeeklyMilestones('2026-07-11', '18:00');
    expect(saturday.registrationOpensAt.toISOString()).toBe('2026-07-06T13:00:00.000Z');
    expect(saturday.registrationClosesAt.toISOString()).toBe('2026-07-07T04:00:00.000Z');
  });

  it('anchors registration to the same Monday/Tuesday for a Sunday game', () => {
    // 2026-07-12 is the Sunday of the same week as 2026-07-10's Friday.
    const sunday = getWeeklyMilestones('2026-07-12', '18:00');
    expect(sunday.registrationOpensAt.toISOString()).toBe('2026-07-06T13:00:00.000Z');
    expect(sunday.registrationClosesAt.toISOString()).toBe('2026-07-07T04:00:00.000Z');
  });
});

describe('currentWeekGameDayCandidates', () => {
  it('returns Friday, Saturday, and Sunday of the current week in order', () => {
    // 2026-07-06 is a Monday; that week's Fri/Sat/Sun are 07-10/11/12.
    expect(currentWeekGameDayCandidates(new Date('2026-07-06T12:00:00.000Z'))).toEqual([
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]);
  });

  it('still returns the upcoming week when today is already Sunday', () => {
    // 2026-07-12 is a Sunday; currentWeekFridayEastern treats this as the
    // end of the week, so the candidates are the *next* Fri/Sat/Sun.
    expect(currentWeekGameDayCandidates(new Date('2026-07-12T12:00:00.000Z'))).toEqual([
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
  });
});

/**
 * How a game reads to a player.
 *
 * The sheet stores `2026-07-10 / 18:00`, which is the right shape for an id
 * and the wrong shape for a sentence. These guard the two ways that
 * conversion goes silently wrong: a date landing on the previous day, and a
 * time formatted in whatever zone the server happens to be in.
 */
describe('formatGameDate', () => {
  it('reads as a person would say it', () => {
    expect(formatGameDate('2026-07-10')).toBe('Friday, July 10');
  });

  it('does not slip to the previous day', () => {
    // `new Date('2026-07-10')` is UTC midnight, which renders as the 9th in
    // every North American zone. That would be wrong in every email and
    // invisible in review.
    expect(formatGameDate('2026-07-10')).toContain('10');
    expect(formatGameDate('2026-01-01')).toBe('Thursday, January 1');
  });

  it('is the same either side of a daylight-saving change', () => {
    // US DST begins 2026-03-08 and ends 2026-11-01. A date is a date.
    expect(formatGameDate('2026-03-07')).toBe('Saturday, March 7');
    expect(formatGameDate('2026-03-08')).toBe('Sunday, March 8');
    expect(formatGameDate('2026-10-31')).toBe('Saturday, October 31');
    expect(formatGameDate('2026-11-01')).toBe('Sunday, November 1');
  });

  it('names the weekday, which is what people actually plan by', () => {
    expect(formatGameDate('2026-07-11')).toMatch(/^Saturday/);
    expect(formatGameDate('2026-07-12')).toMatch(/^Sunday/);
  });
});

describe('formatGameTime', () => {
  it('drops the minutes when there are none', () => {
    expect(formatGameTime('18:00')).toBe('6pm');
  });

  it('keeps them when there are', () => {
    expect(formatGameTime('18:30')).toBe('6:30pm');
    expect(formatGameTime('09:05')).toBe('9:05am');
  });

  it('gets both ends of the clock right', () => {
    // The two every 12-hour conversion gets wrong.
    expect(formatGameTime('00:00')).toBe('12am');
    expect(formatGameTime('12:00')).toBe('12pm');
  });

  it('is lower case, the way someone writes a time to a friend', () => {
    expect(formatGameTime('19:00')).toBe('7pm');
  });
});

describe('formatGameDay', () => {
  it('is how every player-facing mention of a game reads', () => {
    expect(formatGameDay('2026-07-10', '18:00')).toBe('Friday, July 10 at 6pm');
  });
});

describe('formatEasternMoment', () => {
  it('names a moment the same way a game is named', () => {
    // One dialect. Before this there were three: formatGameDay, a private
    // formatEastern in signupFlow, and raw toISOString in the watchdog.
    expect(formatEasternMoment(new Date('2026-09-14T13:00:00Z'))).toBe('Monday, September 14 at 9am');
  });

  it('is Eastern, not the server zone', () => {
    // Registration opens 9am ET whatever clock the runner is on.
    expect(formatEasternMoment(new Date('2026-01-05T14:00:00Z'))).toBe('Monday, January 5 at 9am');
  });

  it('gets midnight right, which is when registration closes', () => {
    expect(formatEasternMoment(new Date('2026-09-15T04:00:00Z'))).toBe('Tuesday, September 15 at 12am');
  });
});
