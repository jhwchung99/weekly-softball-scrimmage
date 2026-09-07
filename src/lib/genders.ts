/**
 * The two options the signup form offers, mirroring positions.ts.
 *
 * Was free text until 2026-09-07, which meant "Male", "male", and "M"
 * were three different values in the same column for no benefit: nothing
 * in the app interprets this field, and the roster is mixed rather than
 * split by it. A fixed pair keeps the stored data uniform and saves
 * everyone typing.
 */
export const GENDERS = ['Male', 'Female'];

/**
 * The canonical spelling of `value`, or '' if it isn't one of GENDERS.
 *
 * Case-insensitive so a row typed as "male" back when this was free text
 * still resolves, and is rewritten to canonical casing the next time
 * that profile is saved.
 */
export function normalizeGender(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return GENDERS.find((g) => g.toLowerCase() === trimmed) ?? '';
}
