import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSignup, updateSignup, deleteSignup } from '../../../../../sheets/signups';
import { SignupStatus } from '../../../../../sheets/schema';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ signupId: string }> };

const VALID_STATUSES: SignupStatus[] = ['confirmed', 'waitlisted', 'cancelled'];

/**
 * "Manually move someone between confirmed / waitlisted / cancelled"
 * (Section 8) — a direct override, unlike the player-facing cancel route.
 * Deliberately does NOT run cancelMySignup's promotion cascade or email
 * notifications: an admin manually setting statuses is already taking
 * explicit manual control of the roster, so those automated side effects
 * would fight the admin's intent rather than help it.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { signupId } = await params;
    const existing = await getSignup(signupId);
    if (!existing) throw new ApiError(404, 'No such signup.');

    const body = await request.json().catch(() => ({}));
    if (!VALID_STATUSES.includes(body?.status)) {
      throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
    }

    const signup = await updateSignup(signupId, { status: body.status });
    return NextResponse.json({ signup });
  } catch (err) {
    return handleApiError(err);
  }
}

/** "Manually add or remove a signup" (Section 8) — the remove half. Hard
 * delete, distinct from setting status to 'cancelled' via PATCH above. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { signupId } = await params;
    const existing = await getSignup(signupId);
    if (!existing) throw new ApiError(404, 'No such signup.');

    await deleteSignup(signupId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
