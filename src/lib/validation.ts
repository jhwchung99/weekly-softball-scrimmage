import { ApiError } from './apiErrors';
import { POSITIONS } from './positions';
import { GENDERS, normalizeGender } from './genders';
import { normalizeEmail } from './email';
import { FEEDBACK_KINDS, FeedbackKind, MAX_FEEDBACK_LENGTH } from './feedbackKinds';

// Added in the 2026-09-04 security hardening pass — these fields were
// previously accepted as arbitrary, unbounded free text (see
// planner/2026-09-04-security-hardening-plan.md, Step 2).

const MAX_NAME_LENGTH = 100;

function requireTrimmedString(value: unknown, fieldName: string, maxLength: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new ApiError(400, `${fieldName} is required.`);
  if (trimmed.length > maxLength) throw new ApiError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

function validateFullName(value: unknown): string {
  return requireTrimmedString(value, 'fullName', MAX_NAME_LENGTH);
}

/** One of GENDERS, normalized to its canonical casing. Checked against the
 * same list the form's radio buttons are built from, like positions. */
function validateGender(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new ApiError(400, 'gender is required.');
  const match = normalizeGender(trimmed);
  if (!match) throw new ApiError(400, `gender must be one of: ${GENDERS.join(', ')}.`);
  return match;
}

/**
 * Comma-separated positions, each checked against the canonical
 * POSITIONS list (src/lib/positions.ts) that the frontend's checkboxes
 * are themselves sourced from. Empty input is allowed — declaring
 * positions isn't required.
 */
function validateSavedPositions(value: unknown): string {
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

function validateCost(value: unknown): number {
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new ApiError(400, 'cost must be a non-negative number.');
  }
  return cost;
}

function validateCapacity(value: unknown): number {
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
function validateGameDate(value: unknown): string {
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
function validateLocationArea(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > MAX_LOCATION_LENGTH) {
    throw new ApiError(400, `locationArea must be ${MAX_LOCATION_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/** The specific field, filled in once the permit is booked. Optional. */
function validateLocationName(value: unknown): string {
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
function validateLocationUrl(value: unknown): string {
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

function validateGameTime(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!GAME_TIME_PATTERN.test(trimmed)) {
    throw new ApiError(400, 'gameTime must be in 24-hour HH:MM format.');
  }
  return trimmed;
}

/**
 * How many diamonds are booked. Two is the practical ceiling for a pickup
 * game, and it is what decides whether the generator makes two teams or four.
 */
function validateNumFields(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 2) {
    throw new ApiError(400, 'numFields must be 1 or 2.');
  }
  return n;
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

const MAX_PAGE_URL_LENGTH = 200;

export interface ValidatedFeedback {
  kind: FeedbackKind;
  message: string;
  pageUrl: string;
}

/**
 * The feedback form's body. Unlike a profile, this text is never stored,
 * only pushed straight to the organizer's phone, so the length cap is
 * what keeps a notification readable rather than what fits a Sheet cell.
 *
 * `pageUrl` is a convenience for the reporter ("which screen was this
 * on"), not a trusted field, so it's clamped to a path rather than
 * accepted as an arbitrary URL: it ends up in a notification the
 * organizer may well tap.
 */
export function validateFeedback(input: { kind?: unknown; message?: unknown; pageUrl?: unknown }): ValidatedFeedback {
  const kind = FEEDBACK_KINDS.find((k) => k === input.kind);
  if (!kind) throw new ApiError(400, `kind must be one of: ${FEEDBACK_KINDS.join(', ')}.`);

  const message = requireTrimmedString(input.message, 'message', MAX_FEEDBACK_LENGTH);

  const rawPageUrl = typeof input.pageUrl === 'string' ? input.pageUrl.trim() : '';
  // Must be a path, and specifically not a protocol-relative one: a browser
  // resolves "//evil.example" to an absolute URL on that host, so accepting
  // it would put an attacker-chosen link in the organizer's notification.
  const isSameSitePath = rawPageUrl.startsWith('/') && !rawPageUrl.startsWith('//');
  const pageUrl = isSameSitePath ? rawPageUrl.slice(0, MAX_PAGE_URL_LENGTH) : '';

  return { kind, message, pageUrl };
}

const MAX_ANNOUNCEMENT_NOTE_LENGTH = 500;

/**
 * The optional sentence an admin can attach to a "Notify players" email.
 *
 * Optional in a way the other validators here are not: '' is a valid answer,
 * because the email stands on its own without it. So this returns '' rather
 * than throwing on an empty value, and only rejects one that is too long to
 * belong in a short email.
 *
 * No escaping or link-stripping, unlike validateFeedback's pageUrl. The author
 * is an admin, the destination is a plain-text email body rather than a header
 * or a notification the organizer might tap, and an organizer who wants to
 * paste a map link into their own note should be able to.
 */
export function validateAnnouncementNote(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > MAX_ANNOUNCEMENT_NOTE_LENGTH) {
    throw new ApiError(400, `note must be ${MAX_ANNOUNCEMENT_NOTE_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Composers
//
// What a route accepts, described once, instead of assembled field by field at
// the call site.
//
// The leaf checks above stay exactly as they are — `validateGameDate` folds
// three rules that four callers depend on, and `validateLocationUrl` carries a
// `javascript:`-URL defence — but they are private now. What was exported was
// as wide as the implementation: nineteen functions, thirteen of them
// single-field checks that were individually well tested. The part that
// actually decided what a request did — which fields were supplied, which get
// validated, which get written — was hand-assembled per route and tested
// nowhere.
// ---------------------------------------------------------------------------

/** A session's editable fields, as the organizer may change them. */
export interface ValidatedSessionEdit {
  /** Only the fields actually supplied. A field absent from the request is
   * absent here, so a partial update can never write one that was not sent. */
  updates: {
    capacity?: number;
    numFields?: number;
    pricePerSpot?: number;
    locationArea?: string;
    locationName?: string;
    locationUrl?: string;
    status?: 'open' | 'closed' | 'cancelled';
    cost?: number;
  };
  /** Present only when the organizer is moving the game. */
  gameDate?: string;
  gameTime?: string;
}

const SESSION_STATUSES = ['open', 'closed', 'cancelled'] as const;

const EDITABLE_FIELDS = [
  'gameDate',
  'gameTime',
  'capacity',
  'numFields',
  'status',
  'cost',
  'pricePerSpot',
  'locationArea',
  'locationName',
  'locationUrl',
] as const;

/**
 * One organizer edit to a session.
 *
 * Rejects a request that names none of the editable fields, so "provide at
 * least one of" is decided here rather than inferred from whether the assembled
 * object happened to come out empty — which is the same answer by accident, and
 * stops being so the moment a field is added that does not write an update.
 */
export function validateSessionEdit(body: unknown): ValidatedSessionEdit {
  const input = (body ?? {}) as Record<string, unknown>;

  if (!EDITABLE_FIELDS.some((field) => input[field] !== undefined)) {
    throw new ApiError(400, `Provide at least one of: ${EDITABLE_FIELDS.join(', ')}.`);
  }

  const updates: ValidatedSessionEdit['updates'] = {};

  if (input.capacity !== undefined) updates.capacity = validateCapacity(input.capacity);
  if (input.numFields !== undefined) updates.numFields = validateNumFields(input.numFields);
  if (input.pricePerSpot !== undefined) updates.pricePerSpot = validateCost(input.pricePerSpot);
  // Location arrives in two stages: the general area up front, the specific
  // field once the permit is actually booked.
  if (input.locationArea !== undefined) updates.locationArea = validateLocationArea(input.locationArea);
  if (input.locationName !== undefined) updates.locationName = validateLocationName(input.locationName);
  if (input.locationUrl !== undefined) updates.locationUrl = validateLocationUrl(input.locationUrl);
  if (input.cost !== undefined) updates.cost = validateCost(input.cost);

  if (input.status !== undefined) {
    const status = SESSION_STATUSES.find((s) => s === input.status);
    if (!status) throw new ApiError(400, `status must be one of: ${SESSION_STATUSES.join(', ')}.`);
    updates.status = status;
  }

  return {
    updates,
    gameDate: input.gameDate !== undefined ? validateGameDate(input.gameDate) : undefined,
    gameTime: input.gameTime !== undefined ? validateGameTime(input.gameTime) : undefined,
  };
}

export interface ValidatedSessionCreate {
  gameDate: string;
  gameTime: string;
  capacity: number;
  cost: number;
  pricePerSpot: number;
  locationArea: string;
}

/**
 * A new session. Unlike an edit, every field ends up with a value: the
 * organizer supplies a date and the rest fall back to the league's defaults,
 * which the caller passes in so the schedule's constants stay in one place.
 */
export function validateSessionCreate(
  input: { gameDate?: unknown; gameTime?: unknown; capacity?: unknown; cost?: unknown; pricePerSpot?: unknown; locationArea?: unknown },
  defaults: { gameTime: string; capacity: number; pricePerSpot: number }
): ValidatedSessionCreate {
  return {
    gameDate: validateGameDate(input.gameDate),
    gameTime: input.gameTime !== undefined ? validateGameTime(input.gameTime) : defaults.gameTime,
    capacity: input.capacity !== undefined ? validateCapacity(input.capacity) : defaults.capacity,
    cost: input.cost !== undefined ? validateCost(input.cost) : 0,
    pricePerSpot: input.pricePerSpot !== undefined ? validateCost(input.pricePerSpot) : defaults.pricePerSpot,
    locationArea: input.locationArea !== undefined ? validateLocationArea(input.locationArea) : '',
  };
}

/** Moving a game to a new date and time. Both are required — a reschedule that
 * changes only one still passes the other through unchanged, so the caller has
 * already filled in whichever half was not supplied. */
export function validateReschedule(gameDate: unknown, gameTime: unknown): { gameDate: string; gameTime: string } {
  return { gameDate: validateGameDate(gameDate), gameTime: validateGameTime(gameTime) };
}

export interface ValidatedSignupOverride {
  status?: 'confirmed' | 'waitlisted' | 'cancelled';
  paid?: boolean;
  amountPaid?: number;
  attended?: boolean;
}

const SIGNUP_STATUSES = ['confirmed', 'waitlisted', 'cancelled'] as const;
const OVERRIDABLE_FIELDS = ['status', 'paid', 'amountPaid', 'attended'] as const;

/**
 * One organizer override of a signup row.
 *
 * `paid` and `attended` are coerced rather than checked, because a checkbox
 * that arrives as anything truthy means the same thing — but they are only
 * *present* when the request named them, which is what keeps an override of
 * one field from silently rewriting another.
 */
export function validateSignupOverride(body: unknown): ValidatedSignupOverride {
  const input = (body ?? {}) as Record<string, unknown>;

  if (!OVERRIDABLE_FIELDS.some((field) => input[field] !== undefined)) {
    throw new ApiError(400, `Provide at least one of: ${OVERRIDABLE_FIELDS.join(', ')}.`);
  }

  const override: ValidatedSignupOverride = {};

  if (input.status !== undefined) {
    const status = SIGNUP_STATUSES.find((s) => s === input.status);
    if (!status) throw new ApiError(400, `status must be one of: ${SIGNUP_STATUSES.join(', ')}.`);
    override.status = status;
  }
  if (input.paid !== undefined) override.paid = Boolean(input.paid);
  if (input.amountPaid !== undefined) override.amountPaid = validateCost(input.amountPaid);
  if (input.attended !== undefined) override.attended = Boolean(input.attended);

  return override;
}
