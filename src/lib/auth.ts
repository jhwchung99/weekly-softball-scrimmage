import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { getServerSession } from 'next-auth';
import { isAdminEmail } from '../sheets/admins';
import { ApiError } from './apiErrors';
import { normalizeEmail } from './email';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * The logged-in player's email — the sole identity source app-wide (Section 4),
 * and the single choke point where inbound identity is normalized. Everything
 * downstream can therefore compare against stored emails without each call
 * site having to remember to lowercase (see lib/email.ts).
 */
export async function getSessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  return email ? normalizeEmail(email) : null;
}

/** Throws if there's no session, or if the session's email isn't on the Admins tab. */
export async function requireAdmin(): Promise<string> {
  const email = await getSessionEmail();
  if (!email) throw new ApiError(401, 'Not signed in.');
  if (!(await isAdminEmail(email))) throw new ApiError(403, `"${email}" is not an admin.`);
  return email;
}
