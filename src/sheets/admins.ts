import { SPREADSHEET_ID, getRowObjects } from './client';
import { Admin, ADMIN_HEADERS, RawRow } from './schema';

const TAB = 'Admins';

export async function listAdminEmails(): Promise<string[]> {
  const rows = await getRowObjects<RawRow<Admin>>(SPREADSHEET_ID, TAB, ADMIN_HEADERS);
  return rows.map((r) => r.data.email.trim().toLowerCase()).filter(Boolean);
}

export async function isAdminEmail(email: string): Promise<boolean> {
  const admins = await listAdminEmails();
  return admins.includes(email.trim().toLowerCase());
}
