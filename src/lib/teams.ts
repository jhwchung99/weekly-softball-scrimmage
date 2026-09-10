import { Signup } from '../sheets/schema';
import { spotsFor, countSpots, isPaired } from './pair';

/**
 * What one team puts on the field. The counts matter: "can this team cover
 * every position" is a question about *slots*, not about distinct position
 * names, because three outfielders need three people.
 *
 * Nine slots, with the rover as the ninth. That matches the game day note
 * telling a short team to drop the rover first.
 */
export const LINEUP: Record<string, number> = {
  Catcher: 1,
  '1B': 1,
  '2B': 1,
  '3B': 1,
  SS: 1,
  Outfield: 3,
  Rover: 1,
};

/** LINEUP flattened to one entry per slot, e.g. Outfield three times. */
export const LINEUP_SLOTS: string[] = Object.entries(LINEUP).flatMap(([pos, n]) => Array<string>(n).fill(pos));

/** A player who lists this covers every position, but still only fills one. */
const WILDCARD = 'Anything';

/** The fields of a Signup this module actually needs, so client DTOs fit too. */
export type Rosterable = Pick<Signup, 'signupId' | 'fullName' | 'gender' | 'positions' | 'pairId'>;

export interface Team {
  name: string;
  members: Rosterable[];
  /** Lineup slots this team cannot fill at once. 0 means a full fielding nine. */
  deficiency: number;
  /** Which positions go unfilled, for the "notes for team" line. */
  missing: string[];
}

function positionsOf(p: Rosterable): string[] {
  return p.positions.split(',').map((s) => s.trim()).filter(Boolean);
}

function canFill(p: Rosterable, slot: string): boolean {
  const own = positionsOf(p);
  return own.includes(slot) || own.includes(WILDCARD);
}

/**
 * Maximum bipartite matching between lineup slots and players (Kuhn's
 * augmenting-path algorithm), returning which player takes each slot.
 *
 * This is the whole reason coverage isn't just a count. A player occupies
 * exactly one position in an inning, so a single "Anything" player is not
 * simultaneously the catcher and the shortstop. Counting who *could* play each
 * position over-reports coverage; matching answers the real question, which is
 * whether an assignment filling every slot exists at all. Solved exactly, so
 * the only approximation in this file is the partition search below.
 *
 * At nine slots and a dozen players this is far too small for Hopcroft-Karp to
 * earn its complexity.
 */
function matchSlots(squad: Rosterable[]): (number | null)[] {
  const slotTakenBy: (number | null)[] = LINEUP_SLOTS.map(() => null);

  const assign = (playerIndex: number, seen: boolean[]): boolean => {
    for (let s = 0; s < LINEUP_SLOTS.length; s++) {
      if (seen[s] || !canFill(squad[playerIndex], LINEUP_SLOTS[s])) continue;
      seen[s] = true;
      const holder = slotTakenBy[s];
      if (holder === null || assign(holder, seen)) {
        slotTakenBy[s] = playerIndex;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < squad.length; i++) assign(i, LINEUP_SLOTS.map(() => false));
  return slotTakenBy;
}

/** Every combination of which half of each shared spot turns up. */
function attendanceScenarios(members: Rosterable[]): Rosterable[][] {
  const spots = spotsFor(members);
  const solo = spots.filter((s) => s.length === 1).map((s) => s[0]);
  const groups = spots.filter((s) => s.length > 1);
  if (groups.length === 0) return [solo];

  const scenarios: Rosterable[][] = [];
  for (let mask = 0; mask < 1 << groups.length; mask++) {
    scenarios.push([...solo, ...groups.map((g, i) => g[(mask >> i) & 1] ?? g[0])]);
  }
  return scenarios;
}

/**
 * How short a team is, and of what.
 *
 * Worst case across who actually turns up from each shared spot: a spot is one
 * player at a time, and the team has to work whichever partner comes. Reporting
 * the best case would call a team covered when it is only covered if the right
 * person shows up.
 */
export function analyzeTeam(members: Rosterable[]): { deficiency: number; missing: string[] } {
  let worst = { deficiency: -1, missing: [] as string[] };

  for (const squad of attendanceScenarios(members)) {
    const taken = matchSlots(squad);
    const missing = LINEUP_SLOTS.filter((_, s) => taken[s] === null);
    if (missing.length > worst.deficiency) {
      worst = { deficiency: missing.length, missing: [...new Set(missing)] };
    }
  }
  return worst;
}

// Deficiency dominates: a team that cannot field a position is a worse outcome
// than an uneven gender split, which in turn matters more than a one-player
// size difference the swap neighbourhood mostly prevents anyway.
const W_DEFICIT = 100;
const W_SIZE = 30;
const W_GENDER = 10;

function spread(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, v) => a + (v - mean) ** 2, 0);
}

/** A shared spot counts once for size, and half each way when its two
 * occupants differ in gender, so the metric stays smooth. */
function femaleWeight(members: Rosterable[]): number {
  return members.reduce((n, m) => n + (m.gender === 'Female' ? (isPaired(m) ? 0.5 : 1) : 0), 0);
}

function scoreTeams(teams: Rosterable[][]): number {
  let score = 0;
  for (const t of teams) score += W_DEFICIT * analyzeTeam(t).deficiency;
  score += W_SIZE * spread(teams.map((t) => countSpots(t)));
  score += W_GENDER * spread(teams.map(femaleWeight));
  return score;
}

/** Deterministic PRNG. The same roster must always produce the same teams, so
 * regenerating never silently reshuffles people. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

// Two teams is easy enough that one pass finds the best split every time; four
// is not. Measured across six 40-player rosters, 1 and 3 restarts each missed
// on two of them by two unfillable slots, while 10 and 20 matched every time.
// 20 costs ~100ms at two teams and ~1s at four, which both sit comfortably
// inside a request. See planner/2026-09-07-team-generation-plan.md.
const RESTARTS = 20;

/**
 * Splits confirmed players into `teamCount` teams, balancing position coverage
 * first, then team size, then gender.
 *
 * Greedy seed plus steepest-descent swaps, restarted. Swapping units between
 * two teams preserves their sizes, which is what keeps size balance nearly
 * free rather than needing a hard constraint.
 *
 * `restarts` is exposed mainly so tests of the structural properties (sizes,
 * pairs staying together) can run cheaply — those hold after a single pass,
 * and four-team instances at the default cost about a second each.
 */
export function buildTeams(players: Rosterable[], teamCount: number, restarts: number = RESTARTS): Team[] {
  const count = Math.max(1, Math.floor(teamCount));
  // Solo players, plus each shared spot as one indivisible unit.
  const units = spotsFor(players);
  const name = (i: number) => `Team ${i + 1}`;

  if (units.length === 0) {
    return Array.from({ length: count }, (_, i) => ({ name: name(i), members: [], ...analyzeTeam([]) }));
  }

  let best: Rosterable[][] | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < Math.max(1, restarts); attempt++) {
    const rand = seeded(attempt + 1);
    const shuffled = [...units].sort(() => rand() - 0.5);
    const buckets: Rosterable[][][] = Array.from({ length: count }, () => []);
    shuffled.forEach((u, i) => buckets[i % count].push(u));

    const flatten = () => buckets.map((b) => b.flat());
    let current = scoreTeams(flatten());

    for (;;) {
      let move: [number, number, number, number] | null = null;
      let moveScore = current;

      for (let x = 0; x < count; x++) {
        for (let y = x + 1; y < count; y++) {
          for (let i = 0; i < buckets[x].length; i++) {
            for (let j = 0; j < buckets[y].length; j++) {
              [buckets[x][i], buckets[y][j]] = [buckets[y][j], buckets[x][i]];
              const s = scoreTeams(flatten());
              [buckets[x][i], buckets[y][j]] = [buckets[y][j], buckets[x][i]];
              if (s < moveScore) {
                moveScore = s;
                move = [x, y, i, j];
              }
            }
          }
        }
      }

      if (!move) break;
      const [x, y, i, j] = move;
      [buckets[x][i], buckets[y][j]] = [buckets[y][j], buckets[x][i]];
      current = moveScore;
    }

    if (current < bestScore) {
      bestScore = current;
      best = flatten();
    }
  }

  return best!.map((members, i) => ({ name: name(i), members, ...analyzeTeam(members) }));
}

/** "Short 1: no one can cover Catcher", or '' when the team can field nine. */
export function teamNote(team: Team): string {
  if (team.deficiency === 0) return '';
  return `Short ${team.deficiency}: no one can cover ${team.missing.join(', ')}`;
}
