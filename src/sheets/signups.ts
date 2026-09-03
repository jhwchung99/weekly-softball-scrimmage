import { randomUUID } from 'node:crypto';
import { SPREADSHEET_ID, getRowObjects, appendValues, updateRow, deleteRow, getOrCreateSheet } from './client';
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
  await appendValues(SPREADSHEET_ID, `${TAB}!A:M`, [SIGNUP_HEADERS.map((h) => row[h])]);
  return full;
}

export async function updateSignupStatus(signupId: string, status: SignupStatus): Promise<void> {
  const all = await rows();
  const match = all.find((r) => r.data.signupId === signupId);
  if (!match) throw new Error(`No signup with id "${signupId}".`);

  const updated = parseSignupRow(match.data);
  updated.status = status;
  await updateRow(SPREADSHEET_ID, TAB, match.rowNumber, SIGNUP_HEADERS, serializeSignupRow(updated));
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
