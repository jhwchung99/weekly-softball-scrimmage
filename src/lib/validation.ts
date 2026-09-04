import { ApiError } from './apiErrors';
import { POSITIONS } from './positions';

// Added in the 2026-09-04 security hardening pass — these fields were
// previously accepted as arbitrary, unbounded free text (see
// planner/2026-09-04-security-hardening-plan.md, Step 2).

const MAX_NAME_LENGTH = 100;
const MAX_GENDER_LENGTH = 30;
const MIN_AGE = 1;
const MAX_AGE = 120;

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

export function validateAge(value: unknown): number {
  const age = Number(value);
  if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) {
    throw new ApiError(400, `age must be a whole number between ${MIN_AGE} and ${MAX_AGE}.`);
  }
  return age;
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

export interface PlayerProfileInput {
  fullName: unknown;
  gender: unknown;
  age: unknown;
  savedPositions?: unknown;
}

export interface ValidatedPlayerProfile {
  fullName: string;
  gender: string;
  age: number;
  savedPositions: string;
}

export function validatePlayerProfile(input: PlayerProfileInput): ValidatedPlayerProfile {
  return {
    fullName: validateFullName(input.fullName),
    gender: validateGender(input.gender),
    age: validateAge(input.age),
    savedPositions: validateSavedPositions(input.savedPositions ?? ''),
  };
}
