import { describe, it, expect, vi } from 'vitest';
import { zonedTimeToUtc, nextMondayEastern, currentWeekFridayEastern, currentWeekGameDayCandidates, getWeeklyMilestones, formatGameDate, formatGameTime, formatGameDay, formatEasternMoment, formatEasternClockTime, relativeGameDay } from '../time';

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

describe('a session that sets its own roster lock', () => {
  it('locks when it says, not five hours before the game', () => {
    // A 10am Saturday game would lock at 5am. Locked at 8pm the Friday
    // instead, so the teams, the cost and the one email all land that evening.
    const milestones = getWeeklyMilestones('2026-07-11', '10:00', { rosterLockAt: '2026-07-11T00:00:00.000Z' });

    expect(milestones.cutoffStart.toISOString()).toBe('2026-07-11T00:00:00.000Z');
    // Everything else is untouched by the override.
    expect(milestones.gameStart.toISOString()).toBe('2026-07-11T14:00:00.000Z');
    expect(milestones.registrationOpensAt.toISOString()).toBe('2026-07-06T13:00:00.000Z');
  });

  it('falls back to the default when the override is blank or unreadable', () => {
    const fiveHoursBefore = '2026-07-10T17:00:00.000Z';

    expect(getWeeklyMilestones('2026-07-10', '18:00', { rosterLockAt: '' }).cutoffStart.toISOString()).toBe(fiveHoursBefore);
    // A hand-edited cell should not be able to take the week's schedule out.
    expect(getWeeklyMilestones('2026-07-10', '18:00', { rosterLockAt: 'not a date' }).cutoffStart.toISOString()).toBe(fiveHoursBefore);
  });
});

describe('a session that sets its own registration window', () => {
  it('opens and closes when it says, not on the derived Monday/Tuesday', () => {
    const milestones = getWeeklyMilestones('2026-07-10', '18:00', {
      registrationOpensAt: '2026-07-01T13:00:00.000Z',
      registrationClosesAt: '2026-07-08T04:00:00.000Z',
    });

    expect(milestones.registrationOpensAt.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(milestones.registrationClosesAt.toISOString()).toBe('2026-07-08T04:00:00.000Z');
    // The game and the lock are untouched by a window override.
    expect(milestones.gameStart.toISOString()).toBe('2026-07-10T22:00:00.000Z');
    expect(milestones.cutoffStart.toISOString()).toBe('2026-07-10T17:00:00.000Z');
  });

  it('overrides each end independently', () => {
    const openOnly = getWeeklyMilestones('2026-07-10', '18:00', { registrationOpensAt: '2026-07-01T13:00:00.000Z' });

    expect(openOnly.registrationOpensAt.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    // Still the derived Tuesday midnight.
    expect(openOnly.registrationClosesAt.toISOString()).toBe('2026-07-07T04:00:00.000Z');
  });

  it('falls back to the derived window when blank or unreadable', () => {
    const derivedOpen = '2026-07-06T13:00:00.000Z';

    expect(
      getWeeklyMilestones('2026-07-10', '18:00', { registrationOpensAt: '' }).registrationOpensAt.toISOString()
    ).toBe(derivedOpen);
    // Same rule as the lock: a hand-edited cell must not take the schedule out.
    expect(
      getWeeklyMilestones('2026-07-10', '18:00', { registrationOpensAt: 'whenever' }).registrationOpensAt.toISOString()
    ).toBe(derivedOpen);
  });

  it('is what makes a midweek game work at all', () => {
    // The derived window for a Monday game closes 12am Tuesday — after the
    // game has been played. phaseOf would read 'open' straight through game
    // time and never reach 'locked'. This is why assertScheduleOrdering makes
    // a Monday game carry its own window.
    const derived = getWeeklyMilestones('2026-07-06', '18:00');
    expect(derived.registrationClosesAt.getTime()).toBeGreaterThan(derived.gameStart.getTime());

    const withWindow = getWeeklyMilestones('2026-07-06', '18:00', {
      registrationOpensAt: '2026-06-29T13:00:00.000Z',
      registrationClosesAt: '2026-07-04T04:00:00.000Z',
    });
    expect(withWindow.registrationClosesAt.getTime()).toBeLessThan(withWindow.cutoffStart.getTime());
    expect(withWindow.cutoffStart.getTime()).toBeLessThan(withWindow.gameStart.getTime());
  });
});

describe('formatEasternClockTime', () => {
  it('spells a time the way formatGameTime does', () => {
    // voice.md rule 11: one email must not contain both "2pm" and "2:00 PM".
    expect(formatEasternClockTime(new Date('2026-07-10T18:00:00.000Z'))).toBe('2pm');
    expect(formatEasternClockTime(new Date('2026-07-10T18:30:00.000Z'))).toBe('2:30pm');
  });
});

describe('relativeGameDay', () => {
  const game = { gameDate: '2026-07-11', gameTime: '10:00' };

  it('says "today" on the day', () => {
    expect(relativeGameDay(game, new Date('2026-07-11T13:00:00.000Z'))).toBe('today');
  });

  it('says "tomorrow" the evening before, which is when an early game sends', () => {
    expect(relativeGameDay(game, new Date('2026-07-11T01:00:00.000Z'))).toBe('tomorrow');
  });

  it('names the day outright when it is further off than tomorrow', () => {
    expect(relativeGameDay(game, new Date('2026-07-08T13:00:00.000Z'))).toBe('Saturday, July 11');
  });
});

describe('nextMondayEastern', () => {
  // The homepage splits "This week" from "Later" here. It used the browser's
  // date, so at 10pm Sunday in Pacific time (already Monday in the East) next
  // week's games were listed as this week's.
  it('reads today in Eastern time, not the viewer\'s zone', () => {
    // 2026-07-13T05:00Z: 1am Monday in Eastern, 10pm Sunday in Pacific.
    expect(nextMondayEastern(new Date('2026-07-13T05:00:00.000Z'))).toBe('2026-07-20');
  });

  it('is the following Monday on a Sunday, and never today', () => {
    expect(nextMondayEastern(new Date('2026-07-12T16:00:00.000Z'))).toBe('2026-07-13'); // Sunday noon ET
    expect(nextMondayEastern(new Date('2026-07-13T16:00:00.000Z'))).toBe('2026-07-20'); // Monday noon ET
  });
});

// Both used to fall back without a word: a bad override quietly became the
// default window, and a bad game time made every milestone NaN, which
// phaseOf reads as 'played'. The fallback stays; the silence does not.
describe('getWeeklyMilestones with an unreadable cell', () => {
  it('warns when an override does not parse, and uses the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const m = getWeeklyMilestones('2026-07-10', '18:00', { registrationClosesAt: 'Thu 9pm' });

    expect(m.registrationClosesAt.toISOString()).toBe('2026-07-07T04:00:00.000Z');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"Thu 9pm"/));
    warn.mockRestore();
  });

  // It threw a RangeError, and /api/home works out every upcoming session's
  // phase, so one bad cell took the whole homepage down. Now only that
  // session is affected.
  it('warns when the game time does not parse, rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => getWeeklyMilestones('2026-07-10', '6pm')).not.toThrow();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/2026-07-10.*"6pm"/));
    warn.mockRestore();
  });
});
