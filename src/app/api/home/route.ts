import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../lib/auth';
import { getSessionByAnyId } from '../../../sheets/sessions';
import { listSignupsForSession } from '../../../sheets/signups';
import { getPlayer } from '../../../sheets/players';
import { currentWeekGameDayCandidates } from '../../../lib/time';
import { buildMyStatus } from '../../../lib/signupFlow';
import { buildRosterView } from '../../../lib/roster';
import { WAIVER_TEXT } from '../../../lib/waiver';
import { handleApiError } from '../../../lib/apiErrors';

/**
 * Everything the homepage renders, in one request.
 *
 * This exists for a specific, measured reason. The page used to make four
 * calls (`/sessions/current`, `/sessions/[id]/signup`, `/players/me`,
 * `/roster`) costing **5 Sheets reads**, because Sessions and Signups were
 * each read twice. All Sheets traffic is attributed to one service account, so
 * the binding quota is 60 reads/minute for the entire app — and registration
 * opening at a fixed weekly time means everyone arrives at once. Reading each
 * tab exactly once takes a page load to **3 reads**, raising the ceiling from
 * roughly 6 to 10 simultaneous signups. See
 * planner/2026-09-05-code-security-review.md, S4.
 *
 * Deliberately a view-model endpoint shaped for one screen rather than a
 * resource: the granular routes still exist and still work, and both paths
 * compute their results from the same shared builders, so there is no second
 * copy of any rule to drift.
 *
 * Public: an unauthenticated caller gets the session and nothing else, which
 * is what the logged-out homepage shows (1 read, since it never touches
 * Signups or Players).
 */
export async function GET() {
  try {
    const email = await getSessionEmail();

    // Read 1 — Sessions.
    const session = await getSessionByAnyId(currentWeekGameDayCandidates());

    if (!email || !session) {
      return NextResponse.json({
        session,
        signedIn: Boolean(email),
        player: null,
        signup: null,
        incomingSubRequests: [],
        costOwed: null,
        roster: null,
        waiverText: WAIVER_TEXT,
      });
    }

    // Reads 2 and 3 — Signups and Players, once each, in parallel.
    const [allSignups, player] = await Promise.all([listSignupsForSession(session.sessionId), getPlayer(email)]);

    const { signup, incomingSubRequests, costOwed } = buildMyStatus(session, allSignups, email);

    return NextResponse.json({
      session,
      signedIn: true,
      player,
      signup,
      incomingSubRequests,
      costOwed,
      roster: buildRosterView(allSignups, email),
      waiverText: WAIVER_TEXT,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
