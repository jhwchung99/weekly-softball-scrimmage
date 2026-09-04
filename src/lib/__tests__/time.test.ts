import { describe, it, expect } from 'vitest';
import { zonedTimeToUtc, isWithinPromotionCutoff, currentWeekFridayEastern, isNearEasternTime } from '../time';

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

describe('isWithinPromotionCutoff', () => {
  const gameDate = '2026-07-10';
  const gameTime = '18:00'; // 22:00 UTC; cutoff starts at 20:00 UTC (2h before)

  it('is false comfortably before the cutoff', () => {
    expect(isWithinPromotionCutoff(gameDate, gameTime, new Date('2026-07-10T19:59:59.000Z'))).toBe(false);
  });

  it('is true exactly at the cutoff boundary', () => {
    expect(isWithinPromotionCutoff(gameDate, gameTime, new Date('2026-07-10T20:00:00.000Z'))).toBe(true);
  });

  it('is true just after the cutoff boundary', () => {
    expect(isWithinPromotionCutoff(gameDate, gameTime, new Date('2026-07-10T20:00:01.000Z'))).toBe(true);
  });

  it('is true well after game time too', () => {
    expect(isWithinPromotionCutoff(gameDate, gameTime, new Date('2026-07-10T23:00:00.000Z'))).toBe(true);
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
});
