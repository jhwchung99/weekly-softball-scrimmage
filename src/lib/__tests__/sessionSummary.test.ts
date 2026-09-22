import { describe, it, expect } from 'vitest';
import { dayLabel, standingLabel, spotsLabel, scheduleNote } from '../sessionSummary';
import type { MySignupView, RosterView } from '../views';

const GAME = { gameDate: '2026-07-10', gameTime: '18:00' }; // Friday, 6pm

const signup = (over: Partial<MySignupView> = {}) =>
  ({ signupId: 's1', status: 'confirmed', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '', practicePollAnswer: '', ...over }) as MySignupView;

const roster = (over: Partial<RosterView> = {}): RosterView =>
  ({ confirmedCount: 14, waitlistedCount: 0, confirmed: [], waitlisted: [], ...over });

describe('dayLabel', () => {
  it('is short enough to sit beside a status on a phone', () => {
    expect(dayLabel(GAME)).toBe('Fri, Jul 10 · 6pm');
  });

  it('reads the date from its parts, never through a Date that shifts it', () => {
    // `new Date('2026-07-10')` is UTC midnight and renders as the 9th in every
    // North American zone. That off-by-one would be invisible in review.
    expect(dayLabel({ gameDate: '2026-07-10', gameTime: '10:30' })).toBe('Fri, Jul 10 · 10:30am');
  });
});

describe('standingLabel', () => {
  it('says nothing about someone with no signup', () => {
    expect(standingLabel(null, null)).toBeNull();
  });

  it('distinguishes confirmed, paid, waitlisted and cancelled', () => {
    expect(standingLabel(signup(), null)).toBe("you're in");
    expect(standingLabel(signup({ paid: true }), null)).toBe("you're in · paid");
    expect(standingLabel(signup({ status: 'waitlisted' }), 2)).toBe('waitlist #2');
    expect(standingLabel(signup({ status: 'cancelled' }), null)).toBe('cancelled');
  });

  it('falls back when the waitlist position is unknown', () => {
    expect(standingLabel(signup({ status: 'waitlisted' }), null)).toBe('waitlisted');
  });
});

describe('spotsLabel', () => {
  it('is null when the viewer cannot be shown a roster', () => {
    expect(spotsLabel({ capacity: 20 }, null)).toBeNull();
  });

  it('counts confirmed against capacity', () => {
    expect(spotsLabel({ capacity: 20 }, roster())).toBe('14/20');
  });
});

describe('scheduleNote', () => {
  it('says when sign-ups open, before they have', () => {
    expect(scheduleNote(GAME, 'before')).toMatch(/^Sign-ups open Monday, July 6 at 9am\.$/);
  });

  it('says midnight rather than 12am, and on the day people mean', () => {
    // The close is Tuesday 00:00 ET. Spelled literally that is "Tuesday,
    // July 7 at 12am", which is correct and how nobody thinks about it.
    const note = scheduleNote(GAME, 'open');

    expect(note).toContain('Sign-ups close Monday, July 6 at midnight.');
    expect(note).not.toContain('12am');
  });

  it('names the lock and what it changes, while sign-ups are open', () => {
    expect(scheduleNote(GAME, 'open')).toContain('The roster locks Friday, July 10 at 1pm, when payment opens.');
  });

  it('drops the closing time once it has passed', () => {
    const note = scheduleNote(GAME, 'closed');

    expect(note).toBe('Sign-ups have closed. The roster locks Friday, July 10 at 1pm, when payment opens.');
  });

  it('warns that cancelling no longer pulls in a replacement, once locked', () => {
    expect(scheduleNote(GAME, 'locked')).toBe(
      'The roster is locked. The game starts at 6pm. Cancelling now will not pull in a replacement.'
    );
  });

  it('has nothing to schedule once the game has started', () => {
    expect(scheduleNote(GAME, 'played')).toBe('This game has started.');
  });

  it('follows a session that sets its own window', () => {
    const own = { ...GAME, registrationClosesAt: '2026-07-09T04:00:00.000Z' }; // Wed midnight ET

    expect(scheduleNote(own, 'open')).toContain('Sign-ups close Wednesday, July 8 at midnight.');
  });

  it('says nothing at all before the server has reported a phase', () => {
    expect(scheduleNote(GAME, null)).toBe('');
  });
});
