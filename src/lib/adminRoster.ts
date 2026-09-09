import { normalizeEmail } from './email';
import { Signup } from '../sheets/schema';

/**
 * How the admin roster reads a person who signed up more than once.
 *
 * Cancelling never deletes a row and re-signing up always writes a new one
 * (see signupFlow.ts), which is correct — each row carries its own waiver
 * acceptance, its own FIFO timestamp, and its own payment record, and reviving
 * the old row would either destroy that evidence or hand back a queue position
 * the person gave up. But the admin view is the one place that shows cancelled
 * rows, and rendered flat in sheet order they look like two different people
 * with the same name rather than one person's history.
 *
 * Pure, and free of Sheets or other server-only imports, so the dashboard and
 * the admin override route agree on what "already has an active signup" means
 * instead of each deciding for itself.
 */

type Rostered = Pick<Signup, 'email' | 'status'>;

/** Anything not cancelled — i.e. holding a spot or waiting for one. */
export function isActiveSignup(signup: Rostered): boolean {
  return signup.status !== 'cancelled';
}

/**
 * The active rows belonging to one person.
 *
 * More than one is a corrupt roster: they'd occupy two capacity slots, be
 * billed twice by computeCostShare, and get two of every email. The signup
 * path can't produce it (createSignup rejects a second active row), so this
 * exists for the paths that could — the admin status override, and anyone
 * editing the sheet by hand.
 *
 * Case-insensitive on both sides: rows are normalized on write, but a
 * hand-typed one might not be, and this is exactly the comparison that must
 * not miss.
 */
export function activeRowsForEmail<T extends Rostered>(signups: T[], email: string): T[] {
  const target = normalizeEmail(email);
  return signups.filter((s) => isActiveSignup(s) && normalizeEmail(s.email) === target);
}

export interface RosterGroup<T> {
  /** Normalized email — the identity everything else in the app keys on. */
  email: string;
  /** This person's rows, current one first and cancelled history after it. */
  rows: T[];
  /** More than one means the roster is double-counting this person. */
  activeCount: number;
}

/**
 * Collapses a flat roster into one group per person.
 *
 * Groups with somebody still active come first, so the list still reads as
 * "who is playing" from the top, with people who signed up and left collected
 * at the bottom. Within each bucket the original sheet order survives, since
 * that is roughly signup order and the organizer already reads it that way.
 */
export function groupRosterByPerson<T extends Rostered>(signups: T[]): RosterGroup<T>[] {
  const byEmail = new Map<string, T[]>();
  for (const signup of signups) {
    const key = normalizeEmail(signup.email);
    const rows = byEmail.get(key);
    if (rows) rows.push(signup);
    else byEmail.set(key, [signup]);
  }

  const groups: RosterGroup<T>[] = [...byEmail].map(([email, rows]) => {
    const active = rows.filter(isActiveSignup);
    return {
      email,
      // Current row first: what makes a repeat signup read as one person's
      // story rather than two strangers who happen to share a name.
      rows: [...active, ...rows.filter((r) => !isActiveSignup(r))],
      activeCount: active.length,
    };
  });

  // A Map iterates in insertion order, so this reorders the two buckets
  // without disturbing the order inside either one.
  return [...groups.filter((g) => g.activeCount > 0), ...groups.filter((g) => g.activeCount === 0)];
}

export interface RosterCounts {
  /** People holding or waiting for a spot — what "roster" normally means. */
  active: number;
  /** Rows left behind by someone who cancelled, counted as rows rather than
   * people: two of them from the same person are two pieces of history. */
  cancelled: number;
}

/** What the roster heading counts. Splitting the two is the point: the header
 * used to count every row, so a week with three re-signups claimed a roster
 * three larger than the number of people playing. */
export function countRoster(signups: Rostered[]): RosterCounts {
  return {
    active: signups.filter(isActiveSignup).length,
    cancelled: signups.filter((s) => !isActiveSignup(s)).length,
  };
}
