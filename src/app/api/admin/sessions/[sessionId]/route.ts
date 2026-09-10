import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSession, updateSession } from '../../../../../sheets/sessions';
import { adminRescheduleSession } from '../../../../../lib/adminFlow';
import { withMutationLock } from '../../../../../lib/lock';
import { Session, SessionStatus } from '../../../../../sheets/schema';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';
import { fillOpenSpots } from '../../../../../lib/signupFlow';
import {
  validateCost,
  validateCapacity,
  validateNumFields,
  validateLocationArea,
  validateLocationName,
  validateLocationUrl,
} from '../../../../../lib/validation';

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
 * The cost is a longer critical section: worst case this is now a rekey
 * (~5 Sheets calls), the field write (1), and the cascade (3 + one per
 * promoted player) under one hold, where the longest single hold before was
 * the cascade alone. Under sustained rate limiting — up to 7s of backoff per
 * call (client.ts, RATE_LIMIT_RETRY_DELAYS_MS) — this is the handler most
 * likely to approach LOCK_TTL_SECONDS, and the first place to look if that
 * ceiling ever needs raising again.
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
      body?.numFields !== undefined ||
      body?.status !== undefined ||
      body?.cost !== undefined ||
      body?.pricePerSpot !== undefined ||
      body?.locationArea !== undefined ||
      body?.locationName !== undefined ||
      body?.locationUrl !== undefined;
    if (!fieldsProvided) {
      throw new ApiError(
        400,
        'Provide at least one of: gameDate, gameTime, capacity, numFields, status, cost, pricePerSpot, locationArea, locationName, locationUrl.'
      );
    }

    // Validation first, and outside the lock: it needs nothing from the sheet,
    // and a request that is going to 400 should not queue behind other
    // mutations — or time out waiting for a lock it never needed and come back
    // as a 503 instead of the validation error the caller earned.
    const updates: Partial<Session> = {};

    if (body.capacity !== undefined) {
      updates.capacity = validateCapacity(body.capacity);
    }

    if (body.numFields !== undefined) {
      updates.numFields = validateNumFields(body.numFields);
    }

    if (body.pricePerSpot !== undefined) {
      updates.pricePerSpot = validateCost(body.pricePerSpot);
    }

    // Location arrives in two stages: the general area up front, the specific
    // field once the permit is actually booked (see the plan doc, section 2).
    if (body.locationArea !== undefined) {
      updates.locationArea = validateLocationArea(body.locationArea);
    }
    if (body.locationName !== undefined) {
      updates.locationName = validateLocationName(body.locationName);
    }
    if (body.locationUrl !== undefined) {
      updates.locationUrl = validateLocationUrl(body.locationUrl);
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

    let session = existing;
    let promoted: Awaited<ReturnType<typeof fillOpenSpots>> = [];

    await withMutationLock(async () => {
      let currentSessionId = sessionId;

      if (body.gameDate !== undefined || body.gameTime !== undefined) {
        session = await adminRescheduleSession(
          sessionId,
          body.gameDate ?? existing.gameDate,
          body.gameTime ?? existing.gameTime
        );
        currentSessionId = session.sessionId;
      }

      if (Object.keys(updates).length > 0) {
        session = await updateSession(currentSessionId, updates);
      }

      // Raising capacity is how the organizer opens a second field, so it has to
      // actually let people in. Without this the new spots stay empty and
      // everyone above the old capacity keeps waiting.
      if (updates.capacity !== undefined && updates.capacity > existing.capacity) {
        promoted = await fillOpenSpots(currentSessionId);
      }
    });

    return NextResponse.json({ session, promoted: promoted.length });
  } catch (err) {
    return handleApiError(err);
  }
}
