import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSession, updateSession } from '../../../../../sheets/sessions';
import { SessionStatus } from '../../../../../sheets/schema';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

const VALID_STATUSES: SessionStatus[] = ['open', 'closed', 'cancelled'];

/**
 * Covers two of Section 8's controls at once, since both are just field
 * updates on the same Sessions row: "adjust session capacity" (capacity)
 * and "cancel an entire session / rainout" (status: 'cancelled').
 *
 * Judgment call: cancelling a session here only flips its own status —
 * it deliberately does NOT bulk-cancel that session's existing signups.
 * Their confirmed/waitlisted status stays as a historical record of who
 * would have played, in case a rained-out game gets rescheduled. Not
 * addressed directly in the guidelines.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const existing = await getSession(sessionId);
    if (!existing) throw new ApiError(404, 'No such session.');

    const body = await request.json().catch(() => ({}));
    const updates: { capacity?: number; status?: SessionStatus } = {};

    if (body?.capacity !== undefined) {
      const capacity = Number(body.capacity);
      if (!Number.isFinite(capacity) || capacity < 0) throw new ApiError(400, 'capacity must be a non-negative number.');
      updates.capacity = capacity;
    }

    if (body?.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
      }
      updates.status = body.status;
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'Provide at least one of: capacity, status.');
    }

    const session = await updateSession(sessionId, updates);
    return NextResponse.json({ session });
  } catch (err) {
    return handleApiError(err);
  }
}
