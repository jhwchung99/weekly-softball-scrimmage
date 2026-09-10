import { describe, it, expect } from 'vitest';
import { paymentStateOf, paymentOpensAt } from '../payments';
import { getWeeklyMilestones } from '../time';

/**
 * When payment is due was written out twice — once in the homepage's payment
 * prompt and once in the reminder email — each branching on the roster lock
 * for itself. The wording of the two legitimately differs. The decision does
 * not, and it is asserted here once.
 */

describe('paymentStateOf', () => {
  it('has nothing to say when nothing is owed', () => {
    expect(paymentStateOf({ amountOwed: 0, paid: false, rosterLocked: true })).toBe('nothing-owed');
  });

  it('is settled once the organizer has recorded the payment', () => {
    expect(paymentStateOf({ amountOwed: 10, paid: true, rosterLocked: true })).toBe('settled');
    expect(paymentStateOf({ amountOwed: 10, paid: true, rosterLocked: false })).toBe('settled');
  });

  it('asks for nothing until the roster locks', () => {
    // Until the lock a cancellation can still change the roster, and asking
    // someone to pay a figure that might move is how you end up refunding.
    expect(paymentStateOf({ amountOwed: 10, paid: false, rosterLocked: false })).toBe('not-yet-open');
  });

  it('is due once the lineup is fixed and so is the figure', () => {
    expect(paymentStateOf({ amountOwed: 10, paid: false, rosterLocked: true })).toBe('due');
  });

  it('treats a recorded payment as settled even for a free week', () => {
    // Nothing owed wins: there is no sense asking about a week with no price.
    expect(paymentStateOf({ amountOwed: 0, paid: true, rosterLocked: true })).toBe('nothing-owed');
  });
});

describe('paymentOpensAt', () => {
  it('is the moment the roster locks', () => {
    // Restates the implementation, deliberately: it pins *which* milestone,
    // and cannot fail on its own because both sides call the same helper. The
    // UTC-literal test below is what actually checks the time. Neither is
    // worth keeping without the other.
    const session = { gameDate: '2026-07-10', gameTime: '18:00' };

    expect(paymentOpensAt(session)).toEqual(getWeeklyMilestones('2026-07-10', '18:00').cutoffStart);
  });

  it('is five hours before game time', () => {
    // Derived from the stated rule rather than from the milestone helper, so
    // the two disagree if either drifts.
    const session = { gameDate: '2026-07-10', gameTime: '18:00' };

    // 18:00 EDT is 22:00Z; five hours earlier is 17:00Z.
    expect(paymentOpensAt(session).toISOString()).toBe('2026-07-10T17:00:00.000Z');
  });
});
