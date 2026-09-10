import { describe, it, expect } from 'vitest';
import { groupRosterByPerson, countRoster, activeRowsForEmail, isActiveSignup } from '../adminRoster';
import type { SignupStatus } from '../../sheets/schema';

const row = (email: string, status: SignupStatus, tag = '') => ({
  email,
  status,
  tag: tag || `${email}:${status}`,
});

describe('groupRosterByPerson', () => {
  it("puts a re-signup under the person's current row instead of loose in the sheet", () => {
    // Kevin cancelled, someone else signed up, then Kevin came back — so his
    // two rows are not adjacent in sheet order.
    const groups = groupRosterByPerson([
      row('kevin@dummy.test', 'cancelled', 'kevin-old'),
      row('sam@dummy.test', 'confirmed', 'sam'),
      row('kevin@dummy.test', 'confirmed', 'kevin-new'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].email).toBe('kevin@dummy.test');
    // Current row first, history after it.
    expect(groups[0].rows.map((r) => r.tag)).toEqual(['kevin-new', 'kevin-old']);
    expect(groups[0].activeCount).toBe(1);
  });

  it('sinks people who left to the bottom, so the top of the list is who is playing', () => {
    const groups = groupRosterByPerson([
      row('gone@dummy.test', 'cancelled'),
      row('playing@dummy.test', 'confirmed'),
      row('waiting@dummy.test', 'waitlisted'),
    ]);

    expect(groups.map((g) => g.email)).toEqual([
      'playing@dummy.test',
      'waiting@dummy.test',
      'gone@dummy.test',
    ]);
  });

  it('keeps sheet order within each bucket, since that is roughly signup order', () => {
    const groups = groupRosterByPerson([
      row('first@dummy.test', 'confirmed'),
      row('second@dummy.test', 'confirmed'),
      row('third@dummy.test', 'confirmed'),
    ]);

    expect(groups.map((g) => g.email)).toEqual(['first@dummy.test', 'second@dummy.test', 'third@dummy.test']);
  });

  it('groups the same person written with different casing', () => {
    const groups = groupRosterByPerson([
      row('Kevin@Dummy.Test', 'cancelled'),
      row('kevin@dummy.test', 'confirmed'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('reports more than one active row, which is a roster that double-counts somebody', () => {
    const groups = groupRosterByPerson([
      row('kevin@dummy.test', 'confirmed', 'a'),
      row('kevin@dummy.test', 'waitlisted', 'b'),
    ]);

    expect(groups[0].activeCount).toBe(2);
  });

  it('handles an empty roster', () => {
    expect(groupRosterByPerson([])).toEqual([]);
  });
});

describe('countRoster', () => {
  it('separates people playing from rows left behind by a cancellation', () => {
    expect(
      countRoster([
        row('a@dummy.test', 'confirmed'),
        row('b@dummy.test', 'waitlisted'),
        row('c@dummy.test', 'cancelled'),
        row('c@dummy.test', 'confirmed'),
      ])
    ).toEqual({ active: 3, cancelled: 1 });
  });
});

describe('activeRowsForEmail', () => {
  const roster = [
    row('kevin@dummy.test', 'cancelled', 'old'),
    row('kevin@dummy.test', 'confirmed', 'new'),
    row('sam@dummy.test', 'confirmed', 'sam'),
  ];

  it('finds the row that is actually holding a spot', () => {
    expect(activeRowsForEmail(roster, 'kevin@dummy.test').map((r) => r.tag)).toEqual(['new']);
  });

  it('matches regardless of casing, because a hand-typed row might not be normalized', () => {
    expect(activeRowsForEmail(roster, 'KEVIN@DUMMY.TEST').map((r) => r.tag)).toEqual(['new']);
  });

  it('returns nothing for someone with only cancelled rows', () => {
    expect(activeRowsForEmail([row('gone@dummy.test', 'cancelled')], 'gone@dummy.test')).toEqual([]);
  });
});

describe('isActiveSignup', () => {
  it('treats waitlisted as active — they are waiting for a spot, not gone', () => {
    expect(isActiveSignup(row('a@dummy.test', 'waitlisted'))).toBe(true);
    expect(isActiveSignup(row('a@dummy.test', 'confirmed'))).toBe(true);
    expect(isActiveSignup(row('a@dummy.test', 'cancelled'))).toBe(false);
  });
});
