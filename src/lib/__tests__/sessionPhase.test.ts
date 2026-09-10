import { describe, it, expect } from 'vitest';
import { phaseOf, isRegistrationOpen, hasRegistrationClosed, isRosterLocked, hasGameStarted } from '../sessionPhase';
import { getWeeklyMilestones } from '../time';

/**
 * The phases are asserted against the schedule the league actually keeps —
 * registration opens Monday 9am Eastern and closes Tuesday midnight Eastern,
 * the roster locks five hours before the game — rather than against whatever
 * `getWeeklyMilestones` happens to return. The expected instants below are
 * written out as UTC literals derived from that stated schedule, so if the
 * arithmetic drifts these disagree with it instead of following it.
 */

/** Friday 2026-07-10, 18:00 ET. July is EDT, so Eastern is UTC-4. */
const SUMMER = { gameDate: '2026-07-10', gameTime: '18:00' };
/** Friday 2026-01-09, 18:00 ET. January is EST, so Eastern is UTC-5. */
const WINTER = { gameDate: '2026-01-09', gameTime: '18:00' };

describe('phaseOf', () => {
  it("is 'before' until registration opens on the Monday", () => {
    // Monday 2026-07-06 09:00 EDT = 13:00Z. One minute earlier is still before.
    expect(phaseOf(SUMMER, new Date('2026-07-06T12:59:00Z'))).toBe('before');
    expect(phaseOf(SUMMER, new Date('2026-07-05T00:00:00Z'))).toBe('before');
  });

  it("turns 'open' exactly at Monday 9am Eastern", () => {
    expect(phaseOf(SUMMER, new Date('2026-07-06T13:00:00Z'))).toBe('open');
  });

  it("stays 'open' until Tuesday midnight Eastern", () => {
    // Tuesday 2026-07-07 00:00 EDT = 2026-07-07T04:00Z.
    expect(phaseOf(SUMMER, new Date('2026-07-07T03:59:00Z'))).toBe('open');
    expect(phaseOf(SUMMER, new Date('2026-07-07T04:00:00Z'))).toBe('closed');
  });

  it("stays 'closed' through the week until the roster locks", () => {
    expect(phaseOf(SUMMER, new Date('2026-07-09T12:00:00Z'))).toBe('closed');
  });

  it("turns 'locked' five hours before game time", () => {
    // Friday 18:00 EDT = 22:00Z; five hours earlier is 17:00Z.
    expect(phaseOf(SUMMER, new Date('2026-07-10T16:59:00Z'))).toBe('closed');
    expect(phaseOf(SUMMER, new Date('2026-07-10T17:00:00Z'))).toBe('locked');
  });

  it("turns 'played' at game time", () => {
    expect(phaseOf(SUMMER, new Date('2026-07-10T21:59:00Z'))).toBe('locked');
    expect(phaseOf(SUMMER, new Date('2026-07-10T22:00:00Z'))).toBe('played');
  });

  it('reads the same wall-clock schedule in winter, when Eastern is an hour further from UTC', () => {
    // Monday 2026-01-05 09:00 EST = 14:00Z — an hour later in UTC than July's,
    // because the schedule is anchored to Eastern wall-clock time, not to UTC.
    expect(phaseOf(WINTER, new Date('2026-01-05T13:59:00Z'))).toBe('before');
    expect(phaseOf(WINTER, new Date('2026-01-05T14:00:00Z'))).toBe('open');

    // Friday 18:00 EST = 23:00Z, so the lock is at 18:00Z.
    expect(phaseOf(WINTER, new Date('2026-01-09T17:59:00Z'))).toBe('closed');
    expect(phaseOf(WINTER, new Date('2026-01-09T18:00:00Z'))).toBe('locked');
    expect(phaseOf(WINTER, new Date('2026-01-09T23:00:00Z'))).toBe('played');
  });

  it('agrees with the milestones it is derived from, at every boundary', () => {
    const { registrationOpensAt, registrationClosesAt, cutoffStart, gameStart } = getWeeklyMilestones(
      SUMMER.gameDate,
      SUMMER.gameTime
    );

    // A boundary belongs to the phase it starts, not the one it ends.
    expect(phaseOf(SUMMER, new Date(registrationOpensAt.getTime() - 1))).toBe('before');
    expect(phaseOf(SUMMER, registrationOpensAt)).toBe('open');
    expect(phaseOf(SUMMER, new Date(registrationClosesAt.getTime() - 1))).toBe('open');
    expect(phaseOf(SUMMER, registrationClosesAt)).toBe('closed');
    expect(phaseOf(SUMMER, new Date(cutoffStart.getTime() - 1))).toBe('closed');
    expect(phaseOf(SUMMER, cutoffStart)).toBe('locked');
    expect(phaseOf(SUMMER, new Date(gameStart.getTime() - 1))).toBe('locked');
    expect(phaseOf(SUMMER, gameStart)).toBe('played');
  });

  it('works for a Saturday or Sunday game, which keep the same Monday schedule', () => {
    const saturday = { gameDate: '2026-07-11', gameTime: '18:00' };
    const sunday = { gameDate: '2026-07-12', gameTime: '18:00' };

    // Same Monday 9am opening as the Friday game in that week.
    expect(phaseOf(saturday, new Date('2026-07-06T13:00:00Z'))).toBe('open');
    expect(phaseOf(sunday, new Date('2026-07-06T13:00:00Z'))).toBe('open');
    // But each locks relative to its own game time.
    expect(phaseOf(saturday, new Date('2026-07-10T22:00:00Z'))).toBe('closed');
    expect(phaseOf(sunday, new Date('2026-07-11T22:00:00Z'))).toBe('closed');
  });
});

describe('the questions the app asks', () => {
  it('says registration is open only while it is open', () => {
    expect(['before', 'closed', 'locked', 'played'].map((p) => isRegistrationOpen(p as never))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(isRegistrationOpen('open')).toBe(true);
  });

  it('says registration has closed for every phase after it closes', () => {
    expect(hasRegistrationClosed('before')).toBe(false);
    expect(hasRegistrationClosed('open')).toBe(false);
    expect(hasRegistrationClosed('closed')).toBe(true);
    expect(hasRegistrationClosed('locked')).toBe(true);
    expect(hasRegistrationClosed('played')).toBe(true);
  });

  it('keeps the roster locked once the game has started', () => {
    // A game in progress is not a roster that has reopened — the detail each
    // call site used to re-derive for itself.
    expect(isRosterLocked('closed')).toBe(false);
    expect(isRosterLocked('locked')).toBe(true);
    expect(isRosterLocked('played')).toBe(true);
  });

  it('says the game has started only once it has', () => {
    expect(hasGameStarted('locked')).toBe(false);
    expect(hasGameStarted('played')).toBe(true);
  });
});
