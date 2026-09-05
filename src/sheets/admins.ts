import { SPREADSHEET_ID, getRowObjects } from './client';
import { Admin, ADMIN_HEADERS, RawRow } from './schema';
import { normalizeEmail } from '../lib/email';

const TAB = 'Admins';

/**
 * The allowlist was re-read from the Sheet on every single admin request —
 * and the admin dashboard makes several per page load, each one a Sheets API
 * call against a quota this app has already exhausted in real use. A short
 * cache cuts that to roughly one read per minute per warm instance.
 *
 * 60s is deliberately short: the whole reason the allowlist lives in a Sheet
 * tab rather than an env var is so admins can be added or removed without a
 * redeploy, and a minute's delay keeps that promise intact. Serverless
 * instances each hold their own copy, which is fine — the cache only ever
 * makes a *revocation* up to a minute late, never grants access that was
 * never in the sheet.
 */
const CACHE_TTL_MS = 60_000;
let cache: { emails: string[]; fetchedAt: number } | undefined;

export async function listAdminEmails(): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.emails;

  const rows = await getRowObjects<RawRow<Admin>>(SPREADSHEET_ID, TAB, ADMIN_HEADERS);
  const emails = rows.map((r) => normalizeEmail(r.data.email)).filter(Boolean);
  cache = { emails, fetchedAt: Date.now() };
  return emails;
}

/** Drops the cached allowlist — for tests, and for any future "I just changed
 * the Admins tab, re-read it now" affordance. */
export function clearAdminCache(): void {
  cache = undefined;
}

export async function isAdminEmail(email: string): Promise<boolean> {
  const admins = await listAdminEmails();
  return admins.includes(normalizeEmail(email));
}
