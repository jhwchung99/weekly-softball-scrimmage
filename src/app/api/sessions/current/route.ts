import { NextResponse } from 'next/server';
import { upcomingSessions } from '../../../../lib/currentWeek';
import { sessionView } from '../../../../lib/views';

/**
 * Public (no auth) — a player should be able to see what is scheduled and its
 * status before signing in, same as they could before by just looking at the
 * Sheet/Form. Only the actual signup/cancel actions require login.
 *
 * Returns every upcoming session, soonest first. It returned one until
 * 2026-09-22, found by taking the first of Friday/Saturday/Sunday that had a
 * row — so a Sunday game created beside a Friday one was invisible here.
 */
export async function GET() {
  // Cached: this route is unauthenticated and costs a Sheets read, and the
  // app's whole quota is 60 reads a minute. See lib/currentWeek.
  const sessions = await upcomingSessions();
  return NextResponse.json({ sessions: sessions.map(sessionView) });
}
