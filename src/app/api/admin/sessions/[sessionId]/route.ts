import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSession, updateSession } from '../../../../../sheets/sessions';
import { adminRescheduleSession } from '../../../../../lib/adminFlow';
import { withMutationLock } from '../../../../../lib/lock';
import { SessionStatus } from '../../../../../sheets/schema';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';
import { validateCost, validateCapacity } from '../../../../../lib/validation';

type Params = { params: Promise<{ sessionId: string }> };

const VALID_STATUSES: SessionStatus[] = ['open', 'closed', 'cancelled'];

/** Session details for any sessionId, not just the current week's — the
 * admin dashboard's "am I admin" check doubles up on this call too. */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');
    return NextResponse.json({ session });
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
 * A gameDate change goes through adminRescheduleSession first (under the
 * mutation lock, since it can rekey the row and cascade every signup's
 * sessionId — see that function's comment) before any other field
 * updates are applied, since those need to land on whatever the
 * session's id ends up being afterward.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const existing = await getSession(sessionId);
    if (!existing) throw new ApiError(404, 'No such session.');

    const body = await request.json().catch(() => ({}));
    const fieldsProvided =
      body?.gameDate !== undefined ||
      body?.gameTime !== undefined ||
      body?.capacity !== undefined ||
      body?.status !== undefined ||
      body?.cost !== undefined;
    if (!fieldsProvided) {
      throw new ApiError(400, 'Provide at least one of: gameDate, gameTime, capacity, status, cost.');
    }

    let session = existing;
    let currentSessionId = sessionId;

    if (body.gameDate !== undefined || body.gameTime !== undefined) {
      session = await withMutationLock(() =>
        adminRescheduleSession(sessionId, body.gameDate ?? existing.gameDate, body.gameTime ?? existing.gameTime)
      );
      currentSessionId = session.sessionId;
    }

    const updates: { capacity?: number; status?: SessionStatus; cost?: number } = {};

    if (body.capacity !== undefined) {
      updates.capacity = validateCapacity(body.capacity);
    }

    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
      }
      updates.status = body.status;
    }

    if (body.cost !== undefined) {
      updates.cost = validateCost(body.cost);
    }

    if (Object.keys(updates).length > 0) {
      session = await updateSession(currentSessionId, updates);
    }

    return NextResponse.json({ session });
  } catch (err) {
    return handleApiError(err);
  }
}
