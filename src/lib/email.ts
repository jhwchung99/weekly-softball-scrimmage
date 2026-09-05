/**
 * Email addresses arrive from three places that don't agree on casing: the
 * Google session (whatever Google reports), the admin "manually add a signup"
 * form (free text an organizer types), and rows already stored in the Sheet.
 * Comparing any two of those with `===` was a real bug — the homepage found a
 * signup case-insensitively while the cancel route rejected it case-sensitively,
 * leaving the player stuck (see planner/2026-09-05-code-security-review.md,
 * Bug 1).
 *
 * The rule now: every email is normalized at the boundary — on the way in from
 * a session, on the way in from a form, and on the way into the Sheet — so
 * everything downstream compares like with like.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
