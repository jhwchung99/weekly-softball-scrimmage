import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';
import { adminCreateSession } from '../../../../lib/adminFlow';
import { withMutationLock } from '../../../../lib/lock';
import { handleApiError } from '../../../../lib/apiErrors';

/** Create a new session (Section 8) — mainly for scheduling a
 * Saturday/Sunday game, or setting up Friday's ahead of the Monday-open
 * cron with a non-default capacity/cost from the start. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const session = await withMutationLock(() =>
      adminCreateSession({
        gameDate: body?.gameDate,
        gameTime: body?.gameTime,
        capacity: body?.capacity,
        cost: body?.cost,
        pricePerSpot: body?.pricePerSpot,
        locationArea: body?.locationArea,
        openImmediately: Boolean(body?.openImmediately),
      })
    );
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
