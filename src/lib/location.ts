/**
 * How a session's location reads at each stage of the week.
 *
 * Location arrives in two parts because of the schedule: the general area is
 * known when the session is created, but the specific field isn't booked until
 * after registration closes Tuesday — the whole reason the window is short. So
 * a player signing up on Monday should see "Mississauga — specific field TBD",
 * and the same player on Thursday should see the actual diamond.
 *
 * See planner/2026-09-05-location-payments-qol-plan.md, section 2.
 */
export interface LocationParts {
  area: string;
  name: string;
  url: string;
}

/** The display text, or '' when nothing has been decided yet. */
export function formatLocation({ area, name }: LocationParts): string {
  if (name && area) return `${name}, ${area}`;
  if (name) return name;
  if (area) return `${area} — specific field TBD`;
  return '';
}

/** True once the actual field is known, as opposed to just the area. */
export function isFieldBooked({ name }: LocationParts): boolean {
  return Boolean(name);
}
