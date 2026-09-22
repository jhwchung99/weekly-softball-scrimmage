import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRACTICE_POLL_THRESHOLD,
  thresholdFor,
  confirmedSpots,
  canOpenPracticePoll,
  canAnswerPracticePoll,
  tallyPracticePoll,
  turnoutRecovered,
  practiceMessageSubject,
  practiceMessageBody,
} from '../practicePoll';
import type { PracticePollAnswer, PracticePollStatus, SignupStatus } from '../../sheets/schema';

/**
 * The rules that decide whether a week is light enough to ask about, and who
 * said what. Pure, so this is where the arithmetic is pinned rather than
 * through a rendered dashboard.
 */

// Far enough out that the game has not started for any of these.
const FUTURE = { gameDate: '2099-01-02', gameTime: '18:00', rosterLockAt: '' };

const session = (over: Partial<{ practicePollStatus: PracticePollStatus; practicePollThreshold: number }> = {}) => ({
  ...FUTURE,
  practicePollStatus: '' as PracticePollStatus,
  practicePollThreshold: 0,
  ...over,
});

let n = 0;
const signup = (
  over: Partial<{ status: SignupStatus; pairId: string; practicePollAnswer: PracticePollAnswer; fullName: string }> = {}
) => ({
  signupId: `s${(n += 1)}`,
  status: 'confirmed' as SignupStatus,
  pairId: '',
  practicePollAnswer: '' as PracticePollAnswer,
  fullName: `Player ${n}`,
  ...over,
});

/** `count` confirmed signups, each holding their own spot. */
const spots = (count: number) => Array.from({ length: count }, () => signup());

describe('thresholdFor', () => {
  it('uses the session’s own number when it has one', () => {
    expect(thresholdFor({ practicePollThreshold: 12 })).toBe(12);
  });

  it('falls back to the default when unset', () => {
    // 0 is "not set", the way rosterLockAt uses ''. The stored value stays
    // honestly blank and one module owns the default.
    expect(thresholdFor({ practicePollThreshold: 0 })).toBe(DEFAULT_PRACTICE_POLL_THRESHOLD);
    expect(DEFAULT_PRACTICE_POLL_THRESHOLD).toBe(16);
  });
});

describe('canOpenPracticePoll', () => {
  it('offers the poll below the threshold and withholds it at or above', () => {
    // The boundary is the whole feature: 16 is enough for a game, 15 is not.
    expect(canOpenPracticePoll(session(), spots(15))).toBe(true);
    expect(canOpenPracticePoll(session(), spots(16))).toBe(false);
    expect(canOpenPracticePoll(session(), spots(17))).toBe(false);
  });

  it('counts a shared spot once, because it is one person on the field', () => {
    // Fifteen spots where three are shared is eighteen people signed up, and
    // still not a game (ADR-0004). Counting heads would hide exactly the week
    // this poll exists for.
    const shared = [
      ...spots(13),
      signup({ pairId: 'p1' }),
      signup({ pairId: 'p1' }),
      signup({ pairId: 'p2' }),
      signup({ pairId: 'p2' }),
    ];

    expect(shared.filter((s) => s.status === 'confirmed')).toHaveLength(17);
    expect(confirmedSpots(shared)).toBe(15);
    expect(canOpenPracticePoll(session(), shared)).toBe(true);
  });

  it('respects a threshold the session set for itself', () => {
    // Two fields booked: twenty is the number that means "not enough".
    expect(canOpenPracticePoll(session({ practicePollThreshold: 20 }), spots(18))).toBe(true);
    expect(canOpenPracticePoll(session({ practicePollThreshold: 20 }), spots(20))).toBe(false);
  });

  it('will not open a second poll over an open one', () => {
    expect(canOpenPracticePoll(session({ practicePollStatus: 'open' }), spots(10))).toBe(false);
  });

  it('will not open one after the game has started', () => {
    const past = { ...session(), gameDate: '2020-01-04', gameTime: '18:00' };
    expect(canOpenPracticePoll(past, spots(5))).toBe(false);
  });

  it('lets a closed poll be reopened while the week is still light', () => {
    expect(canOpenPracticePoll(session({ practicePollStatus: 'closed' }), spots(10))).toBe(true);
  });
});

describe('canAnswerPracticePoll', () => {
  const open = { ...FUTURE, practicePollStatus: 'open' as PracticePollStatus };

  it('lets a confirmed player answer while the poll is open', () => {
    expect(canAnswerPracticePoll(open, { status: 'confirmed' })).toBe(true);
  });

  it('refuses a waitlisted or cancelled player', () => {
    // Only the people who would actually turn up are asked.
    expect(canAnswerPracticePoll(open, { status: 'waitlisted' })).toBe(false);
    expect(canAnswerPracticePoll(open, { status: 'cancelled' })).toBe(false);
  });

  it('refuses once the poll is closed, which is what makes the panel read-only', () => {
    const closed = { ...FUTURE, practicePollStatus: 'closed' as PracticePollStatus };
    expect(canAnswerPracticePoll(closed, { status: 'confirmed' })).toBe(false);
  });

  it('refuses once the game has started', () => {
    const played = { gameDate: '2020-01-04', gameTime: '18:00', rosterLockAt: '', practicePollStatus: 'open' as PracticePollStatus };
    expect(canAnswerPracticePoll(played, { status: 'confirmed' })).toBe(false);
  });
});

describe('tallyPracticePoll', () => {
  it('counts silence apart from no', () => {
    // An organizer reading "3 no" when two of them simply have not opened the
    // app would decide the wrong thing.
    const tally = tallyPracticePoll([
      signup({ practicePollAnswer: 'yes', fullName: 'Yes One' }),
      signup({ practicePollAnswer: 'yes', fullName: 'Yes Two' }),
      signup({ practicePollAnswer: 'no', fullName: 'No One' }),
      signup({ fullName: 'Quiet One' }),
    ]);

    expect(tally).toMatchObject({ yes: 2, no: 1, unanswered: 1 });
    expect(tally.yesNames).toEqual(['Yes One', 'Yes Two']);
    expect(tally.noNames).toEqual(['No One']);
    expect(tally.unansweredNames).toEqual(['Quiet One']);
  });

  it('ignores anyone who is not confirmed', () => {
    const tally = tallyPracticePoll([
      signup({ practicePollAnswer: 'yes' }),
      signup({ status: 'waitlisted', practicePollAnswer: 'yes' }),
      signup({ status: 'cancelled', practicePollAnswer: 'no' }),
    ]);

    expect(tally).toMatchObject({ yes: 1, no: 0, unanswered: 0 });
  });

  it('counts both halves of a shared spot, unlike the threshold', () => {
    // The threshold asks "can we field a game" and counts spots. This asks
    // "who said they would come", and two people sharing a spot each answer.
    const tally = tallyPracticePoll([
      signup({ pairId: 'p1', practicePollAnswer: 'yes' }),
      signup({ pairId: 'p1', practicePollAnswer: 'no' }),
    ]);

    expect(tally).toMatchObject({ yes: 1, no: 1 });
  });
});

describe('turnoutRecovered', () => {
  it('flags an open poll on a week that filled up after all', () => {
    expect(turnoutRecovered(session({ practicePollStatus: 'open' }), spots(16))).toBe(true);
  });

  it('says nothing when the week is still light, or when no poll is open', () => {
    expect(turnoutRecovered(session({ practicePollStatus: 'open' }), spots(15))).toBe(false);
    expect(turnoutRecovered(session({ practicePollStatus: 'closed' }), spots(16))).toBe(false);
    expect(turnoutRecovered(session(), spots(16))).toBe(false);
  });
});

describe('the drafted message', () => {
  const booked = {
    gameDate: '2099-01-02',
    gameTime: '18:00',
    locationArea: 'Mississauga',
    locationName: 'Iceland Park Diamond 3',
    locationUrl: '',
  };

  it('names the day in the subject', () => {
    expect(practiceMessageSubject(booked)).toBe('BP/Practice on Friday, January 2');
  });

  it('leads with why, then when and where', () => {
    const body = practiceMessageBody(booked);

    expect(body).toMatch(/^Not enough people signed up for a game this week/);
    expect(body).toContain('Iceland Park Diamond 3');
    expect(body).toContain('6pm');
  });

  it('drops the location line entirely until the field is booked', () => {
    // Rather than saying "TBD", which tells the reader nothing they did not
    // already know.
    const body = practiceMessageBody({ ...booked, locationArea: '', locationName: '' });

    expect(body).not.toMatch(/ at \./);
    expect(body).not.toMatch(/TBD/i);
  });

  it('adds no greeting, because the email template already does', () => {
    // sendPlainMessageEmail puts "Hi <name>," on the front. A second one here
    // would read as a stutter.
    expect(practiceMessageBody(booked)).not.toMatch(/^Hi /);
  });
});
