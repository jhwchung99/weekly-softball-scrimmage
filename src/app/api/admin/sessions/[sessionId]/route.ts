import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSession } from '../../../../../sheets/sessions';
import { reviseSession } from '../../../../../lib/adminFlow';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';
import { validateSessionEdit } from '../../../../../lib/validation';
import { adminSessionView } from '../../../../../lib/views';

type Params = { params: Promise<{ sessionId: string }> };

/** Session details for any sessionId, not just the current week's — the
 * admin dashboard's "am I admin" check doubles up on this call too. */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');
    return NextResponse.json({ session: adminSessionView(session) });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Covers Section 8's session-editing controls, all just field updates on
 * the same Sessions row: "adjust session capacity" (capacity), "cancel
 * an entire session / rainout" (status: 'cancelled'), pricing (cost),
 * and rescheduling (gameDate/gameTime).
 *
 * Judgment call: cancelling a session here only flips its own status —
 * it deliberately does NOT bulk-cancel that session's existing signups.
 * Their confirmed/waitlisted status stays as a historical record of who
 * would have played, in case a rained-out game gets rescheduled. Not
 * addressed directly in the guidelines.
 *
 * A gameDate change goes through adminRescheduleSession first (it can rekey
 * the row and cascade every signup's sessionId — see that function's comment)
 * before any other field updates are applied, since those need to land on
 * whatever the session's id ends up being afterward.
 *
 * The whole mutation sequence — reschedule, field updates, promotion cascade
 * — runs under a single mutation lock. Capacity used to be written between two
 * separate acquisitions, which left a window where a signup could read the
 * raised capacity as "there is room" before the cascade that acts on it had
 * run, and oversubscribe the week. One acquisition has no such window, and a
 * reschedule can no longer be observed half-applied either.
 *
 *
 * Validates, then hands the whole edit to `reviseSession`, which serializes
 * it. Validation stays here and stays outside the lock: it needs nothing from
 * the sheet, and a request that is going to 400 should not queue behind other
 * mutations or time out waiting for a lock it never needed.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const existing = await getSession(sessionId);
    if (!existing) throw new ApiError(404, 'No such session.');

    const body = await request.json().catch(() => ({}));
    const revision = validateSessionEdit(body);

    const { session, promoted } = await reviseSession(sessionId, existing, revision);

    return NextResponse.json({ session: adminSessionView(session), promoted: promoted.length });
  } catch (err) {
    return handleApiError(err);
  }
}
