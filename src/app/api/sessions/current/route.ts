import { NextResponse } from 'next/server';
import { getSessionByAnyId } from '../../../../sheets/sessions';
import { currentWeekGameDayCandidates } from '../../../../lib/time';

/**
 * Public (no auth) — a player should be able to see whether there's a
 * scrimmage this week and its status before signing in, same as they
 * could before by just looking at the Sheet/Form. Only the actual
 * signup/cancel actions require login. Game day can be Friday, Saturday,
 * or Sunday, so this checks all three rather than a single fixed id.
 */
export async function GET() {
  const session = await getSessionByAnyId(currentWeekGameDayCandidates());
  return NextResponse.json({ session });
}
