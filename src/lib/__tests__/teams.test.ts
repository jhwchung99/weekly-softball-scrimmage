import { describe, it, expect } from 'vitest';
import { buildTeams, analyzeTeam, teamNote, LINEUP_SLOTS, Rosterable } from '../teams';

let n = 0;
function player(positions: string, extra: Partial<Rosterable> = {}): Rosterable {
  n += 1;
  return { signupId: `s${n}`, fullName: `P${n}`, gender: 'Male', positions, pairId: '', ...extra };
}

/** A squad that can comfortably field nine, for tests about something else. */
function fullSquad(count = 12): Rosterable[] {
  return Array.from({ length: count }, () => player('Anything'));
}

describe('analyzeTeam: coverage is a matching, not a count', () => {
  it('reports every slot missing for an empty team', () => {
    expect(analyzeTeam([]).deficiency).toBe(LINEUP_SLOTS.length);
  });

  it('will not use one wildcard to cover two empty positions', () => {
    // Nine players for nine slots, so a naive count sees no problem: every
    // position has someone who "can play" it, because the lone wildcard is
    // counted for both Catcher and SS. They can only stand in one place, so
    // the team is genuinely short one. This is the bug the counting model had.
    const squad = [
      player('Anything'),
      player('1B'), player('1B'),
      player('2B'), player('3B'),
      player('Outfield'), player('Outfield'), player('Outfield'),
      player('Rover'),
    ];
    expect(squad).toHaveLength(LINEUP_SLOTS.length);
    expect(analyzeTeam(squad).deficiency).toBe(1);
  });

  it('counts a wildcard as filling exactly one slot', () => {
    const specialists = ['Catcher', '1B', '2B', '3B', 'SS', 'Outfield', 'Outfield', 'Outfield'].map((p) => player(p));
    expect(analyzeTeam(specialists).deficiency).toBe(1); // no rover
    expect(analyzeTeam([...specialists, player('Anything')]).deficiency).toBe(0);
  });

  it('names the positions nobody can cover', () => {
    const squad = ['1B', '2B', '3B', 'SS', 'Outfield', 'Outfield', 'Outfield', 'Rover'].map((p) => player(p));
    expect(analyzeTeam(squad).missing).toEqual(['Catcher']);
  });

  it('reports a full nine as covered', () => {
    const squad = ['Catcher', '1B', '2B', '3B', 'SS', 'Outfield', 'Outfield', 'Outfield', 'Rover'].map((p) => player(p));
    expect(analyzeTeam(squad)).toEqual({ deficiency: 0, missing: [] });
  });

  it('handles multi-position players by moving them where they are needed', () => {
    // Everyone lists Catcher first; a naive first-come assignment would put
    // one there and call the rest unusable.
    const squad = ['Catcher, 1B', 'Catcher, 2B', 'Catcher, 3B', 'Catcher, SS', 'Catcher, Outfield', 'Catcher, Outfield', 'Catcher, Outfield', 'Catcher, Rover', 'Catcher'].map((p) => player(p));
    expect(analyzeTeam(squad).deficiency).toBe(0);
  });
});

describe('analyzeTeam: shared spots', () => {
  it('takes the worst case over which partner turns up', () => {
    const base = ['1B', '2B', '3B', 'SS', 'Outfield', 'Outfield', 'Outfield', 'Rover'].map((p) => player(p));
    // One half of the shared spot catches, the other does not. The team only
    // has a catcher if the right person comes, so it counts as short.
    const squad = [...base, player('Catcher', { pairId: 'pair-1' }), player('1B', { pairId: 'pair-1' })];
    expect(analyzeTeam(squad).missing).toEqual(['Catcher']);
  });

  it('is covered when both halves of the spot can play the position', () => {
    const base = ['1B', '2B', '3B', 'SS', 'Outfield', 'Outfield', 'Outfield', 'Rover'].map((p) => player(p));
    const squad = [...base, player('Catcher', { pairId: 'pair-1' }), player('Catcher', { pairId: 'pair-1' })];
    expect(analyzeTeam(squad).deficiency).toBe(0);
  });
});

describe('teamNote', () => {
  // Narrowed to the two fields it reads so the client's TeamView fits too;
  // the editor used to carry its own copy for want of that.
  it('says nothing when the team can field nine', () => {
    expect(teamNote({ deficiency: 0, missing: [] })).toBe('');
  });

  it('names what is short', () => {
    expect(teamNote({ deficiency: 2, missing: ['Catcher', 'SS'] })).toBe(
      'Short 2: no one can cover Catcher, SS'
    );
  });
});

describe('buildTeams', () => {
  it('splits into the requested number of teams', () => {
    expect(buildTeams(fullSquad(24), 2, 1)).toHaveLength(2);
    expect(buildTeams(fullSquad(40), 4, 1)).toHaveLength(4);
  });

  it('keeps team sizes within one of each other', () => {
    for (const [count, teams] of [[24, 2], [25, 2], [40, 4], [41, 4], [43, 4]] as const) {
      const sizes = buildTeams(fullSquad(count), teams, 1).map((t) => t.members.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('assigns every player exactly once', () => {
    const players = fullSquad(23);
    const assigned = buildTeams(players, 2, 1).flatMap((t) => t.members.map((m) => m.signupId));
    expect(assigned.sort()).toEqual(players.map((p) => p.signupId).sort());
  });

  it('keeps both halves of a shared spot on the same team', () => {
    const players = [
      ...fullSquad(20),
      player('Anything', { pairId: 'pair-1' }),
      player('Anything', { pairId: 'pair-1' }),
      player('Anything', { pairId: 'pair-2' }),
      player('Anything', { pairId: 'pair-2' }),
    ];
    for (const pairId of ['pair-1', 'pair-2']) {
      const teamsWithPartner = buildTeams(players, 2, 3).filter((t) => t.members.some((m) => m.pairId === pairId));
      expect(teamsWithPartner).toHaveLength(1);
    }
  });

  it('evens out the gender split', () => {
    const players = [
      ...Array.from({ length: 8 }, () => player('Anything', { gender: 'Female' })),
      ...Array.from({ length: 12 }, () => player('Anything', { gender: 'Male' })),
    ];
    const females = buildTeams(players, 2).map((t) => t.members.filter((m) => m.gender === 'Female').length);
    expect(Math.abs(females[0] - females[1])).toBeLessThanOrEqual(1);
  });

  it('spreads scarce positions rather than stacking them', () => {
    // Exactly two catchers. Putting both on one team strands the other.
    const players = [
      player('Catcher'), player('Catcher'),
      ...Array.from({ length: 18 }, () => player('1B, 2B, 3B, SS, Outfield, Rover')),
    ];
    const teams = buildTeams(players, 2);
    expect(teams.every((t) => t.deficiency === 0)).toBe(true);
    expect(teams.every((t) => t.members.some((m) => m.positions.includes('Catcher')))).toBe(true);
  });

  it('is deterministic, so regenerating never silently reshuffles', () => {
    const players = fullSquad(24);
    const once = buildTeams(players, 2).map((t) => t.members.map((m) => m.signupId));
    const twice = buildTeams(players, 2).map((t) => t.members.map((m) => m.signupId));
    expect(twice).toEqual(once);
  });

  it('survives degenerate rosters', () => {
    expect(buildTeams([], 2).every((t) => t.members.length === 0)).toBe(true);
    expect(buildTeams(fullSquad(1), 2).flatMap((t) => t.members)).toHaveLength(1);
    expect(buildTeams(fullSquad(3), 4).flatMap((t) => t.members)).toHaveLength(3);
  });

  it('reports the shortfall when there are simply not enough players', () => {
    const teams = buildTeams(fullSquad(10), 2); // five each, nine slots
    expect(teams.every((t) => t.deficiency === 4)).toBe(true);
  });
});
