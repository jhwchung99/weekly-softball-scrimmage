import { randomUUID } from 'node:crypto';
import {
  SPREADSHEET_ID,
  getRowObjects,
  appendValues,
  updateRow,
  deleteRow,
  getOrCreateSheet,
  columnLetter,
  batchUpdateRows,
} from './client';
import { Signup, SignupStatus, SIGNUP_HEADERS, parseSignupRow, serializeSignupRow } from './schema';
import { normalizeEmail } from '../lib/email';

const TAB = 'Signups';

async function rows() {
  return getRowObjects<ReturnType<typeof serializeSignupRow>>(SPREADSHEET_ID, TAB, SIGNUP_HEADERS);
}

export async function listSignupsForSession(sessionId: string): Promise<Signup[]> {
  const all = await rows();
  return all.filter((r) => r.data.sessionId === sessionId).map((r) => parseSignupRow(r.data));
}

export async function getSignup(signupId: string): Promise<Signup | null> {
  const all = await rows();
  const match = all.find((r) => r.data.signupId === signupId);
  return match ? parseSignupRow(match.data) : null;
}

/**
 * One signup plus every signup in its session, from a single tab read —
 * for callers (requestSub, respondToSubRequest, cancelMySignup) that
 * previously called getSignup then separately listSignupsForSession,
 * doing two full-tab reads where one suffices. See
 * planner/2026-09-04-profile-edit-rate-limiting-testing-plan.md, Step 2.
 */
export async function getSignupWithSessionSignups(
  signupId: string
): Promise<{ signup: Signup | null; sessionSignups: Signup[] }> {
  const all = await rows();
  const match = all.find((r) => r.data.signupId === signupId);
  if (!match) return { signup: null, sessionSignups: [] };
  const signup = parseSignupRow(match.data);
  const sessionSignups = all.filter((r) => r.data.sessionId === signup.sessionId).map((r) => parseSignupRow(r.data));
  return { signup, sessionSignups };
}

/** Every signup matching the given ids, from a single tab read — used by
 * promoteNextWaitlisted so fetching a promoted pair (1-2 ids) is one
 * read instead of one per id. */
export async function getSignupsByIds(signupIds: string[]): Promise<Signup[]> {
  if (signupIds.length === 0) return [];
  const idSet = new Set(signupIds);
  const all = await rows();
  return all.filter((r) => idSet.has(r.data.signupId)).map((r) => parseSignupRow(r.data));
}

/**
 * A cancelled signup doesn't count against the uniqueness rule — someone
 * who cancelled should be able to sign up again for the same session.
 * Email matching is case-insensitive on both sides, so a row stored with
 * different casing still counts as the same person (see lib/email.ts).
 */
export async function findActiveSignup(sessionId: string, email: string): Promise<Signup | null> {
  const target = normalizeEmail(email);
  const signups = await listSignupsForSession(sessionId);
  return signups.find((s) => normalizeEmail(s.email) === target && s.status !== 'cancelled') ?? null;
}

export function generateSignupId(): string {
  return randomUUID();
}

/**
 * Enforces the "uniqueness on (sessionId, email)" rule from Section 4 —
 * the Sheet itself has no constraint mechanism, so this is the only place
 * it's actually enforced. `signup.signupId` is ignored if already set;
 * one is always generated here so callers can't accidentally collide ids.
 */
export async function createSignup(signup: Omit<Signup, 'signupId'>): Promise<Signup> {
  const existing = await findActiveSignup(signup.sessionId, signup.email);
  if (existing) {
    throw new Error(`"${signup.email}" is already signed up for session "${signup.sessionId}".`);
  }

  // Normalized on the way in so no new casing variants ever reach the Sheet.
  const full: Signup = {
    ...signup,
    email: normalizeEmail(signup.email),
    subRequestTargetEmail: signup.subRequestTargetEmail ? normalizeEmail(signup.subRequestTargetEmail) : '',
    signupId: generateSignupId(),
  };
  const row = serializeSignupRow(full);
  await appendValues(SPREADSHEET_ID, `${TAB}!A:${columnLetter(SIGNUP_HEADERS.length)}`, [SIGNUP_HEADERS.map((h) => row[h])]);
  return full;
}

/** Partial update of any field(s) on an existing signup row. */
export async function updateSignup(signupId: string, updates: Partial<Signup>): Promise<Signup> {
  const all = await rows();
  const match = all.find((r) => r.data.signupId === signupId);
  if (!match) throw new Error(`No signup with id "${signupId}".`);

  const updated: Signup = { ...parseSignupRow(match.data), ...updates };
  await updateRow(SPREADSHEET_ID, TAB, match.rowNumber, SIGNUP_HEADERS, serializeSignupRow(updated));
  return updated;
}

export async function updateSignupStatus(signupId: string, status: SignupStatus): Promise<void> {
  await updateSignup(signupId, { status });
}

/**
 * Applies several signup updates in one Sheets API call instead of one
 * updateRow per signup — e.g. respondToSubRequest's accept path writes
 * the target's pairId, the requester's pairId/status/cleared-request
 * fields, and any auto-declined other requests, all in one call. Order
 * of the returned array matches `updates`, but callers should look up by
 * signupId rather than rely on that, since it's an easy mistake to make.
 */
export async function batchUpdateSignups(updates: { signupId: string; updates: Partial<Signup> }[]): Promise<Signup[]> {
  if (updates.length === 0) return [];
  const all = await rows();
  const lastCol = columnLetter(SIGNUP_HEADERS.length);

  const results: Signup[] = [];
  const rangeUpdates = updates.map(({ signupId, updates: partial }) => {
    const match = all.find((r) => r.data.signupId === signupId);
    if (!match) throw new Error(`No signup with id "${signupId}".`);
    const updated: Signup = { ...parseSignupRow(match.data), ...partial };
    results.push(updated);
    const row = serializeSignupRow(updated);
    return { range: `${TAB}!A${match.rowNumber}:${lastCol}${match.rowNumber}`, values: SIGNUP_HEADERS.map((h) => row[h]) };
  });

  await batchUpdateRows(SPREADSHEET_ID, rangeUpdates);
  return results;
}

/**
 * Section 5: a guest who named `memberFullName` as their inviter, is
 * willing to share a slot, and isn't paired yet — i.e. someone the member
 * should merge with if/when they sign up. FIFO if more than one guest
 * named the same member (only the first pairs; see signupFlow.ts).
 */
export async function findPendingGuestInvite(sessionId: string, memberFullName: string): Promise<Signup | null> {
  const signups = await listSignupsForSession(sessionId);
  const candidates = signups
    .filter(
      (s) =>
        s.memberStatus === 'guest' &&
        s.willingToShare &&
        !s.pairId &&
        s.status !== 'cancelled' &&
        s.invitedByName.trim().toLowerCase() === memberFullName.trim().toLowerCase()
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return candidates[0] ?? null;
}

/** The named member's own (non-cancelled) signup for this session, if any. */
export async function findMemberSignupByName(sessionId: string, memberFullName: string): Promise<Signup | null> {
  const signups = await listSignupsForSession(sessionId);
  return (
    signups.find(
      (s) =>
        s.memberStatus === 'member' &&
        s.status !== 'cancelled' &&
        s.fullName.trim().toLowerCase() === memberFullName.trim().toLowerCase()
    ) ?? null
  );
}

/** Hard delete — for admin "remove a signup" (Section 8). Normal
 * cancellation should go through updateSignupStatus instead. */
export async function deleteSignup(signupId: string): Promise<void> {
  const all = await rows();
  const match = all.find((r) => r.data.signupId === signupId);
  if (!match) throw new Error(`No signup with id "${signupId}".`);

  const tab = await getOrCreateSheet(SPREADSHEET_ID, TAB);
  await deleteRow(SPREADSHEET_ID, tab.sheetId, match.rowNumber);
}
