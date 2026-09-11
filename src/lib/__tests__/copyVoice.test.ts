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
  // JSX text is not a literal, so it is swept separately. No length floor:
  // the first version required twelve characters and so could not see
  // `</strong>, Eastern</li>` — nine characters, and exactly the kind of
  // trailing fragment where an inconsistency hides. Anything with a letter in
  // it counts.
  const jsxText = (withoutComments.match(/>[^<>{}\n]+</g) ?? []).filter((t) => /[A-Za-z]/.test(t));
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

  it('names the time zone one way, and that way is ET', () => {
    // The guidelines page said "9am ET" and "midnight ... Eastern" two bullets
    // apart, for the same zone.
    const offenders = strings.filter((s) => /\bEastern\b/.test(prose(s)));
    expect(offenders, 'write ET').toEqual([]);
  });

  it('writes a whole hour without its minutes', () => {
    // formatGameTime renders "9am", so prose quoting the same moment must not
    // say "9:00am" beside it.
    const offenders = strings.filter((s) => /\d:00\s?(am|pm)/i.test(prose(s)));
    expect(offenders, 'write 9am, not 9:00am').toEqual([]);
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

  it('says players "share" a spot, never that they "sub"', () => {
    // Nobody is substituted or replaced: two people hold one spot and take
    // turns. The emails always said "share"; the homepage and the request
    // errors said "sub" for the same thing, one sentence apart in places.
    // CONTEXT.md keeps "Sub request" as the code's name for the record —
    // ADR-0005 is why the reader's word may differ from the glossary's.
    // Standalone only. "sub-request" is the code's compound name for the
    // record, and it legitimately appears in the deliver() log labels, which
    // no player reads.
    const offenders = strings.filter((s) => /(?<![-\w])subs?(?![-\w])/i.test(prose(s)));
    expect(offenders, 'players share a spot').toEqual([]);
  });

  it('uses none of the banned sign-offs and softeners', () => {
    const banned = [/See you on the field/i, /\bThanks!/, /A quick reminder/i, /Feel free to/i, /\bJust a\b/i];
    const offenders = strings.filter((s) => banned.some((b) => b.test(prose(s))));
    expect(offenders, 'state the fact; do not decorate it').toEqual([]);
  });

  it('leaves the game-day email with no "payment opens" hedge', () => {
    // The email only sends after the roster locks, so payment is open by
    // definition when it lands. The nudge keeps that sentence, because it is
    // allowed to go out early; this is about the email that is not.
    const email = readFileSync(join(ROOT, 'lib', 'notifications.ts'), 'utf8');
    const body = email.slice(email.indexOf('export async function sendGameDayReminderEmail'));
    const untilNextExport = body.slice(0, body.indexOf('\nexport ', 1));

    expect(untilNextExport).not.toMatch(/payment opens/i);
  });

  it('keeps the game-day notes free of terminal full stops', () => {
    // They are bullets in all three places they appear, beside hand-written
    // ones that have none.
    const notes = readFileSync(join(ROOT, 'lib', 'gameDayNotes.ts'), 'utf8');
    const bullets = [...notes.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);

    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.filter((b) => b.endsWith('.'))).toEqual([]);
  });

  it('promises players an event, not a clock time, for the game-day email', () => {
    // The guidelines used to say the email arrives "on game-day morning" and
    // that payment opens "5 hours before game time". Both stopped being true
    // when the send moved to the lock and the lock became per-session.
    const guidelines = readFileSync(join(ROOT, 'app', 'guidelines', 'page.tsx'), 'utf8');

    expect(guidelines).not.toMatch(/game-day morning/i);
    expect(guidelines).not.toMatch(/5 hours before game time/i);
  });
});
