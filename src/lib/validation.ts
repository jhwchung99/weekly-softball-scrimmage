import { ApiError } from './apiErrors';
import { POSITIONS } from './positions';
import { normalizeEmail } from './email';

// Added in the 2026-09-04 security hardening pass — these fields were
// previously accepted as arbitrary, unbounded free text (see
// planner/2026-09-04-security-hardening-plan.md, Step 2).

const MAX_NAME_LENGTH = 100;
const MAX_GENDER_LENGTH = 30;

function requireTrimmedString(value: unknown, fieldName: string, maxLength: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new ApiError(400, `${fieldName} is required.`);
  if (trimmed.length > maxLength) throw new ApiError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

export function validateFullName(value: unknown): string {
  return requireTrimmedString(value, 'fullName', MAX_NAME_LENGTH);
}

export function validateGender(value: unknown): string {
  return requireTrimmedString(value, 'gender', MAX_GENDER_LENGTH);
}

/**
 * Comma-separated positions, each checked against the canonical
 * POSITIONS list (src/lib/positions.ts) that the frontend's checkboxes
 * are themselves sourced from. Empty input is allowed — declaring
 * positions isn't required.
 */
export function validateSavedPositions(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const entries = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const invalid = entries.filter((p) => !POSITIONS.includes(p));
  if (invalid.length > 0) {
    throw new ApiError(400, `Unknown position(s): ${invalid.join(', ')}.`);
  }
  return entries.join(', ');
}

export function validateInvitedByName(value: unknown): string {
  return requireTrimmedString(value, 'invitedByName', MAX_NAME_LENGTH);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Basic shape check only — doesn't verify the address is a real Google
 * account. That's guaranteed downstream instead: requestSub only accepts
 * a targetEmail that already has an active signup for the session.
 *
 * Returns the normalized (lowercased) form, so a hand-typed address can't
 * introduce a casing variant that later comparisons would miss.
 */
export function validateEmail(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
    throw new ApiError(400, 'A valid email address is required.');
  }
  return normalizeEmail(trimmed);
}

export function validateCost(value: unknown): number {
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new ApiError(400, 'cost must be a non-negative number.');
  }
  return cost;
}

export function validateCapacity(value: unknown): number {
  const capacity = Number(value);
  if (!Number.isFinite(capacity) || capacity < 0) {
    throw new ApiError(400, 'capacity must be a non-negative number.');
  }
  return capacity;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Also doubles as a session's id (see sheets/sessions.ts), so this checks
 * the date is real, not just shaped like one — "2026-02-30" round-trips
 * to a different date through the JS Date constructor otherwise. */
export function validateGameDate(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    throw new ApiError(400, 'gameDate must be an ISO date (YYYY-MM-DD).');
  }
  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isReal) {
    throw new ApiError(400, 'gameDate must be a real calendar date.');
  }
  const weekday = date.getUTCDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  if (weekday !== 5 && weekday !== 6 && weekday !== 0) {
    throw new ApiError(400, 'gameDate must fall on a Friday, Saturday, or Sunday.');
  }
  return trimmed;
}

const MAX_LOCATION_LENGTH = 120;

/** The general area, known at session creation — e.g. "Mississauga". Optional:
 * an empty value just means no area has been decided yet. */
export function validateLocationArea(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > MAX_LOCATION_LENGTH) {
    throw new ApiError(400, `locationArea must be ${MAX_LOCATION_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/** The specific field, filled in once the permit is booked. Optional. */
export function validateLocationName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > MAX_LOCATION_LENGTH) {
    throw new ApiError(400, `locationName must be ${MAX_LOCATION_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Optional map link. Restricted to http(s) because this value is rendered as
 * an anchor href — without the check, a `javascript:` URL saved by an admin
 * would execute for every player viewing the page.
 */
export function validateLocationUrl(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError(400, 'locationUrl must be a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'locationUrl must start with http:// or https://.');
  }
  return trimmed;
}

const GAME_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateGameTime(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!GAME_TIME_PATTERN.test(trimmed)) {
    throw new ApiError(400, 'gameTime must be in 24-hour HH:MM format.');
  }
  return trimmed;
}

export interface PlayerProfileInput {
  fullName: unknown;
  gender: unknown;
  savedPositions?: unknown;
}

export interface ValidatedPlayerProfile {
  fullName: string;
  gender: string;
  savedPositions: string;
}

export function validatePlayerProfile(input: PlayerProfileInput): ValidatedPlayerProfile {
  return {
    fullName: validateFullName(input.fullName),
    gender: validateGender(input.gender),
    savedPositions: validateSavedPositions(input.savedPositions ?? ''),
  };
}
