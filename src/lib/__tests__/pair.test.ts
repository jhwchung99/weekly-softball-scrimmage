import { describe, it, expect } from 'vitest';
import { isPaired, slotKey, partnerOf, slotsFor, countSlots, slotSizeOf, alreadySharingReason } from '../pair';

/**
 * The invariant in one sentence: a pair is one slot, and its rows move
 * together. Everything below is a way of asking that, so the tests are written
 * as statements about spots rather than about the field underneath.
 */

const row = (signupId: string, pairId = '') => ({ signupId, pairId });

describe('isPaired', () => {
  it('is true only for a row that is sharing', () => {
    expect(isPaired(row('a'))).toBe(false);
    expect(isPaired(row('a', 'p1'))).toBe(true);
  });
});

describe('slotKey', () => {
  it('gives both halves of a pair the same key', () => {
    expect(slotKey(row('a', 'p1'))).toBe(slotKey(row('b', 'p1')));
  });

  it('gives an unpaired row a key of its own', () => {
    expect(slotKey(row('a'))).not.toBe(slotKey(row('b')));
  });

  it('cannot collide a pair key with an unpaired row that shares the id', () => {
    // Guards the `pairId || signupId` shape: an unpaired row keyed by its own
    // signupId must not land in the same slot as a pair named after it.
    const slots = slotsFor([row('a'), row('b', 'a')]);
    expect(slots).toHaveLength(2);
  });
});

describe('partnerOf', () => {
  it('finds the other half of a shared spot', () => {
    const a = row('a', 'p1');
    const b = row('b', 'p1');
    expect(partnerOf(a, [a, b])?.signupId).toBe('b');
  });

  it('is null for an unpaired row', () => {
    const a = row('a');
    expect(partnerOf(a, [a, row('b')])).toBeNull();
  });

  it('is null when the partner is outside the rows given', () => {
    // A partner who cancelled correctly stops being shown on the roster.
    const a = row('a', 'p1');
    expect(partnerOf(a, [a])).toBeNull();
  });

  it('never returns the row itself', () => {
    const a = row('a', 'p1');
    expect(partnerOf(a, [a, a])).toBeNull();
  });
});

describe('slotsFor', () => {
  it('collapses a pair into one slot holding both rows', () => {
    const slots = slotsFor([row('a', 'p1'), row('b', 'p1')]);

    expect(slots).toHaveLength(1);
    expect(slots[0].map((s) => s.signupId)).toEqual(['a', 'b']);
  });

  it('gives every unpaired row its own slot', () => {
    expect(slotsFor([row('a'), row('b'), row('c')])).toHaveLength(3);
  });

  it('keeps a pair together even when other rows sit between them', () => {
    const slots = slotsFor([row('a', 'p1'), row('x'), row('b', 'p1')]);

    expect(slots.map((s) => s.map((r) => r.signupId))).toEqual([['a', 'b'], ['x']]);
  });

  it('preserves first-appearance order, which the waitlist and the generator rely on', () => {
    const slots = slotsFor([row('first'), row('second', 'p1'), row('third', 'p1'), row('fourth')]);

    expect(slots.map((s) => s[0].signupId)).toEqual(['first', 'second', 'fourth']);
  });

  it('keeps a half-present pair as a slot rather than dropping it', () => {
    // Their partner cancelled, or sits outside the caller's filter. The
    // remaining row still occupies a spot.
    const slots = slotsFor([row('a', 'p1')]);

    expect(slots).toHaveLength(1);
    expect(slots[0].map((s) => s.signupId)).toEqual(['a']);
  });

  it('has no slots for no rows', () => {
    expect(slotsFor([])).toEqual([]);
  });
});

describe('countSlots', () => {
  it('counts a pair once and everyone else individually', () => {
    expect(countSlots([row('a', 'p1'), row('b', 'p1'), row('c'), row('d')])).toBe(3);
  });

  it('still counts the spot while one half of a pair remains', () => {
    // The whole of "either partner can cancel without freeing the spot": the
    // caller filters out the cancelled row and the count is unchanged.
    const both = [row('a', 'p1'), row('b', 'p1'), row('c')];
    const oneLeft = [row('a', 'p1'), row('c')];

    expect(countSlots(both)).toBe(2);
    expect(countSlots(oneLeft)).toBe(2);
  });

  it('counts two separate pairs as two slots', () => {
    expect(countSlots([row('a', 'p1'), row('b', 'p1'), row('c', 'p2'), row('d', 'p2')])).toBe(2);
  });
});

describe('slotSizeOf', () => {
  it('is 1 for someone with a spot to themselves', () => {
    const a = row('a');
    expect(slotSizeOf(a, [a, row('b')])).toBe(1);
  });

  it('is 2 when a spot is shared, so its price halves', () => {
    const a = row('a', 'p1');
    expect(slotSizeOf(a, [a, row('b', 'p1')])).toBe(2);
  });

  it('is 1 when the partner is not among the rows given, so nobody is billed for a ghost', () => {
    const a = row('a', 'p1');
    expect(slotSizeOf(a, [a])).toBe(1);
  });
});

describe('alreadySharingReason', () => {
  it('has no objection to someone who is not sharing', () => {
    expect(alreadySharingReason(row('a'))).toBeNull();
  });

  it('keeps the wording players have always seen', () => {
    // This string reaches a player mid-request; the refactor unifies which one
    // they get, not what it says.
    expect(alreadySharingReason(row('a', 'p1'))).toBe("You're already sharing a slot with someone else.");
  });

  it('lets the caller name the subject the way its reader will recognise it', () => {
    // Who counts as "you" flips between the two request paths.
    expect(alreadySharingReason(row('a', 'p1'), 'That person is')).toBe(
      'That person is already sharing a slot with someone else.'
    );
    expect(alreadySharingReason(row('a', 'p1'), 'That signup is')).toMatch(/^That signup is already sharing a slot/);
  });
});
