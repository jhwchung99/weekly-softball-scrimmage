import { NextResponse } from 'next/server';
import { requireSignedIn } from '../../../../../lib/auth';
import { listSignupsForSession } from '../../../../../sheets/signups';
import { rosterView } from '../../../../../lib/views';
import { handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/**
 * Player-facing roster. Two levels of visibility:
 *
 * - Anyone signed in gets the **counts**, so they can see how full the week is
 *   before deciding whether to sign up.
 * - Only someone with an active signup for this session gets the **names**.
 *
 * Emails are never returned at either level (a sub request assumes the
 * requester already personally knows who they'd ask).
 *
 * The gate exists because sign-in is open to any Google account and session ids
 * are just dates, so an ungated roster let anyone who found the URL enumerate
 * the full membership of the group, week by week. Requiring skin in the game to
 * see names keeps sub requests working — you have to be on the list to ask
 * someone on the list — while closing that.
 *
 * The shaping itself lives in lib/roster.ts, shared with /api/home so the
 * access-control rule has exactly one implementation.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const email = await requireSignedIn();

    const { sessionId } = await params;
    const signups = await listSignupsForSession(sessionId);

    return NextResponse.json(rosterView(signups, email));
  } catch (err) {
    return handleApiError(err);
  }
}
