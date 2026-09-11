/**
 * The same reminders every week, shown under the posted teams on both the
 * admin dashboard and the player view.
 *
 * Separate from the per-team notes the generator produces (which positions a
 * given team cannot cover): those are computed and change as players move,
 * these are fixed. Kept in their own module, beside positions.ts and
 * genders.ts, so the wording lives in one place.
 *
 * House style: short sentences, no dashes, and **no terminal full stop** —
 * these are bullets in both places they appear, and the guidelines page sets
 * them beside hand-written bullets that have none. One list with two
 * punctuation styles in it is the kind of thing a reader notices without being
 * able to say why.
 */
export const GAME_DAY_NOTES = [
  // First on purpose: it frames the four under it, all of which are about
  // running a game that does not match what the app printed.
  'Teams are a suggestion so nobody spends game time picking sides, and you can change them at the field',
  'If you are down to 8 players, play without a rover',
  'The regular season rule about 3 girls on the field does not apply, but everyone should get equal playing time',
  'Two people sharing a spot take turns, so only one of them plays at a time',
  'If someone cancels after teams are posted, that team plays a person short',
];
