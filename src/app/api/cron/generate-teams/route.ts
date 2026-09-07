import { NextResponse } from 'next/server';
import { requireCronSecret } from '../../../../lib/cronAuth';
import { generateTeamsIfDue } from '../../../../lib/teamFlow';
import { getSessionByAnyId } from '../../../../sheets/sessions';
import { currentWeekGameDayCandidates } from '../../../../lib/time';
import { handleApiError } from '../../../../lib/apiErrors';

/**
 * Draws up a first pass at teams once the roster locks, then pushes the
 * organizer to review it.
 *
 * Unlike the other three crons this cannot fire at a fixed clock time: the
 * lock is game time minus five hours, and game time varies per session. So the
 * workflow runs this hourly on Friday, Saturday and Sunday and the endpoint
 * decides whether it is due. `teamsStatus` makes that idempotent, which also
 * means this needs none of the isNearEasternTime guarding the fixed-time jobs
 * use to discard their DST duplicate.
 */
export async function POST(request: Request) {
  try {
    requireCronSecret(request);

    const session = await getSessionByAnyId(currentWeekGameDayCandidates(new Date()));
    if (!session) return NextResponse.json({ generated: false, reason: 'No session for this week.' });

    const result = await generateTeamsIfDue(session.sessionId);
    return NextResponse.json({ sessionId: session.sessionId, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
