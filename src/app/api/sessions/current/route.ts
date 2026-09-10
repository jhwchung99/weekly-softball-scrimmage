import { NextResponse } from 'next/server';
import { currentWeekSession } from '../../../../lib/currentWeek';
import { sessionView } from '../../../../lib/views';

/**
 * Public (no auth) — a player should be able to see whether there's a
 * scrimmage this week and its status before signing in, same as they
 * could before by just looking at the Sheet/Form. Only the actual
 * signup/cancel actions require login. Game day can be Friday, Saturday,
 * or Sunday, so this checks all three rather than a single fixed id.
 */
export async function GET() {
  // Cached: this route is unauthenticated and costs a Sheets read, and the
  // app's whole quota is 60 reads a minute. See lib/currentWeek.
  const session = await currentWeekSession();
  return NextResponse.json({ session: session ? sessionView(session) : null });
}
