import { NextResponse } from 'next/server';
import { getSession } from '../../../../sheets/sessions';
import { currentWeekFridayEastern } from '../../../../lib/time';

/**
 * Public (no auth) — a player should be able to see whether there's a
 * scrimmage this week and its status before signing in, same as they
 * could before by just looking at the Sheet/Form. Only the actual
 * signup/cancel actions require login.
 */
export async function GET() {
  const sessionId = currentWeekFridayEastern();
  const session = await getSession(sessionId);
  return NextResponse.json({ session });
}
