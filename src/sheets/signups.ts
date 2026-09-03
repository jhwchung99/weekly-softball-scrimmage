import { randomUUID } from 'node:crypto';
import { SPREADSHEET_ID, getRowObjects, appendValues, updateRow, deleteRow, getOrCreateSheet, columnLetter } from './client';
import { Signup, SignupStatus, SIGNUP_HEADERS, parseSignupRow, serializeSignupRow } from './schema';

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
 * A cancelled signup doesn't count against the uniqueness rule — someone
 * who cancelled should be able to sign up again for the same session.
 */
export async function findActiveSignup(sessionId: string, email: string): Promise<Signup | null> {
  const signups = await listSignupsForSession(sessionId);
  return signups.find((s) => s.email === email && s.status !== 'cancelled') ?? null;
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

  const full: Signup = { ...signup, signupId: generateSignupId() };
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
