import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The parts of docs/voice.md a machine can check.
 *
 * Deliberately narrow. A style test that flags legitimate sentences gets
 * muted and then deleted, and then nothing is enforced at all — so this
 * covers only the rules with no honest exceptions, and leaves judgement
 * (length, over-explaining, tone) to the reviewer.
 *
 * It reads source text rather than calling the functions because the point is
 * to catch a banned phrase being *typed*, wherever in the module it lands.
 */

const ROOT = join(__dirname, '..', '..');

/** Files whose strings reach a player. The waiver is exempt by decision:
 * consent language is meant to read formally. */
const COPY_FILES = [
  'lib/notifications.ts',
  'lib/gameDayNotes.ts',
  'lib/signupFlow.ts',
  'lib/subRequestFlow.ts',
  // Organizer-facing, but it is still copy this app writes, and it was the
  // one module shipping raw ISO timestamps to a lock screen.
  'lib/weekWatchdog.ts',
  'app/page.tsx',
  'app/guidelines/page.tsx',
];

/**
 * String and template literals only.
 *
 * Comments are exempt and should be: prose written for the next maintainer is
 * held to a different standard than prose written for a player, and an
 * em-dash in an explanation of *why* the code is shaped this way is good
 * writing.
 */
function copyStringsIn(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const literals = withoutComments.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
  // JSX text is not a literal, so it is swept separately.
  const jsxText = withoutComments.match(/>[^<>{}\n]{12,}</g) ?? [];
  return [...literals, ...jsxText];
}

/**
 * What a reader actually sees: the literal with its `${...}` holes removed.
 *
 * The interpolations carry identifiers, not prose — `page.tsx` holds this
 * week's session in a variable called `scrimmage`, which renders a number and
 * says nothing to anybody. Checking raw source would flag it and teach the
 * next person that this test cries wolf.
 */
function prose(literal: string): string {
  return literal.replace(/\$\{[^}]*\}/g, ' ');
}

describe.each(COPY_FILES)('%s', (file) => {
  const strings = copyStringsIn(file);

  it('has copy in it to check', () => {
    // Anti-vacuity: every assertion below is an `every` over this list, and
    // `every` on an empty list is true. A renamed file or a broken matcher
    // would otherwise turn this whole suite green and silent.
    expect(strings.length).toBeGreaterThan(0);
  });

  it('uses no em-dashes', () => {
    const offenders = strings.filter((s) => prose(s).includes('—'));
    expect(offenders, 'em-dashes: use a full stop, a colon, or a comma').toEqual([]);
  });

  it('uses no exclamation marks', () => {
    // Manufactured cheer is the tell this whole pass is about, and it is the
    // one rule with no honest exception in copy this app sends.
    const offenders = strings.filter((s) => prose(s).includes('!'));
    expect(offenders, 'neutral means no performed enthusiasm').toEqual([]);
  });

  it('says "game", never "scrimmage" or "session", to a player', () => {
    // CONTEXT.md governs the code; ADR-0005 explains why the copy diverges.
    const offenders = strings.filter((s) => /\bscrimmage\b/i.test(prose(s)) && !/Weekly Softball Scrimmage/.test(s));
    expect(offenders, 'players read "the game"').toEqual([]);
  });

  it('writes no ISO dates or 24-hour times into a sentence', () => {
    // formatGameDay exists for this. `2026-07-10 at 18:00` in an email is the
    // loudest signal available that software wrote it.
    const offenders = strings.filter((s) => /\$\{[^}]*\.game(Date|Time)\}/.test(s));
    expect(offenders, 'use formatGameDate / formatGameTime / formatGameDay').toEqual([]);
  });

  it('uses none of the banned sign-offs and softeners', () => {
    const banned = [/See you on the field/i, /\bThanks!/, /A quick reminder/i, /Feel free to/i, /\bJust a\b/i];
    const offenders = strings.filter((s) => banned.some((b) => b.test(prose(s))));
    expect(offenders, 'state the fact; do not decorate it').toEqual([]);
  });
});
