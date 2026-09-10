import { describe, it, expect } from 'vitest';
import { makeSignup } from '../../test/fakeSheets';
import { tierOf, waitingSpots, nextInLine, positionOf } from '../waitlist';

/**
 * Promotion order was private to the signup flow, so the only way to ask it
 * anything was to drive a mutation and see who came out. These ask it directly.
 */

const SESSION = '2099-01-01';
let n = 0;
const at = (iso: string, over: Parameters<typeof makeSignup>[0] = {}) =>
  makeSignup({ signupId: `s${n++}`, sessionId: SESSION, status: 'waitlisted', timestamp: iso, ...over });

describe('tierOf', () => {
  it('puts members first', () => {
    expect(tierOf({ memberStatus: 'member', willingToShare: false })).toBe(0);
  });

  it('puts a guest willing to share ahead of one who is not', () => {
    // The ordering is what makes declaring the willingness worth anything.
    expect(tierOf({ memberStatus: 'guest', willingToShare: true })).toBeLessThan(
      tierOf({ memberStatus: 'guest', willingToShare: false })
    );
  });
});

describe('waitingSpots', () => {
  it('is empty when nobody is waiting', () => {
    expect(waitingSpots([at('2099-01-01T00:00:00Z', { status: 'confirmed' })])).toEqual([]);
  });

  it('orders first-come within a tier', () => {
    const later = at('2099-01-02T00:00:00Z', { memberStatus: 'member' });
    const earlier = at('2099-01-01T00:00:00Z', { memberStatus: 'member' });

    expect(waitingSpots([later, earlier]).map((s) => s.signupIds[0])).toEqual([earlier.signupId, later.signupId]);
  });

  it('puts a member ahead of a guest who signed up earlier', () => {
    // Tier beats timestamp: that is the whole of "members first".
    const guest = at('2099-01-01T00:00:00Z', { memberStatus: 'guest', willingToShare: false });
    const member = at('2099-01-05T00:00:00Z', { memberStatus: 'member' });

    expect(waitingSpots([guest, member])[0].signupIds).toEqual([member.signupId]);
  });

  it('puts a sharing-willing guest ahead of one who is not, whoever came first', () => {
    const unwilling = at('2099-01-01T00:00:00Z', { memberStatus: 'guest', willingToShare: false });
    const willing = at('2099-01-05T00:00:00Z', { memberStatus: 'guest', willingToShare: true });

    expect(waitingSpots([unwilling, willing])[0].signupIds).toEqual([willing.signupId]);
  });

  it('treats a waiting pair as one place, holding both rows', () => {
    const a = at('2099-01-01T00:00:00Z', { pairId: 'p1' });
    const b = at('2099-01-02T00:00:00Z', { pairId: 'p1' });

    const queue = waitingSpots([a, b]);
    expect(queue).toHaveLength(1);
    expect(queue[0].signupIds).toEqual([a.signupId, b.signupId]);
  });

  it('gives a pair the better tier and the earlier time of its two rows', () => {
    // Agreeing to share must never cost a pair its position.
    const guest = at('2099-01-05T00:00:00Z', { pairId: 'p1', memberStatus: 'guest', willingToShare: false });
    const member = at('2099-01-01T00:00:00Z', { pairId: 'p1', memberStatus: 'member' });

    const [spot] = waitingSpots([guest, member]);
    expect(spot.tier).toBe(0);
    expect(spot.timestamp).toBe('2099-01-01T00:00:00Z');
  });

  it('leaves out a pair that already holds its spot through the other partner', () => {
    // The waitlisted row is along for the ride, not waiting for anything.
    const waiting = at('2099-01-01T00:00:00Z', { pairId: 'p1' });
    const confirmed = at('2099-01-01T00:00:00Z', { pairId: 'p1', status: 'confirmed' });

    expect(waitingSpots([waiting, confirmed])).toEqual([]);
  });

  it('still queues a solo waitlister when someone else holds a shared spot', () => {
    const solo = at('2099-01-01T00:00:00Z');
    const confirmedPair = at('2099-01-01T00:00:00Z', { pairId: 'p1', status: 'confirmed' });

    expect(waitingSpots([solo, confirmedPair]).map((s) => s.signupIds[0])).toEqual([solo.signupId]);
  });
});

describe('nextInLine', () => {
  it('is nobody when the queue is empty', () => {
    expect(nextInLine([])).toBeNull();
  });

  it('is the front of the queue', () => {
    const guest = at('2099-01-01T00:00:00Z', { memberStatus: 'guest', willingToShare: false });
    const member = at('2099-01-05T00:00:00Z', { memberStatus: 'member' });

    expect(nextInLine([guest, member])?.signupIds).toEqual([member.signupId]);
  });

  it('carries both halves of a promoted pair, so neither is left unnotified', () => {
    const a = at('2099-01-01T00:00:00Z', { pairId: 'p1' });
    const b = at('2099-01-02T00:00:00Z', { pairId: 'p1' });

    expect(nextInLine([a, b])?.signupIds).toHaveLength(2);
  });
});

describe('positionOf', () => {
  it('is null for someone who is not waiting', () => {
    const confirmed = at('2099-01-01T00:00:00Z', { status: 'confirmed' });
    expect(positionOf(confirmed.signupId, [confirmed])).toBeNull();
  });

  it('counts from one, in signup order', () => {
    const first = at('2099-01-01T00:00:00Z');
    const second = at('2099-01-02T00:00:00Z');
    const third = at('2099-01-03T00:00:00Z');
    const roster = [third, first, second];

    expect(positionOf(first.signupId, roster)).toBe(1);
    expect(positionOf(second.signupId, roster)).toBe(2);
    expect(positionOf(third.signupId, roster)).toBe(3);
  });

  it('answers "how many are ahead of me" rather than "who is promoted next"', () => {
    // Deliberate: a guest who signed up first is 1st in line by arrival, but a
    // member who came later is promoted before them. Position is a good-faith
    // indicator, not a promise — and the two live together so that is visible.
    const guest = at('2099-01-01T00:00:00Z', { memberStatus: 'guest', willingToShare: false });
    const member = at('2099-01-05T00:00:00Z', { memberStatus: 'member' });
    const roster = [guest, member];

    expect(positionOf(guest.signupId, roster)).toBe(1);
    expect(nextInLine(roster)?.signupIds).toEqual([member.signupId]);
  });
});
