import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { validateCost } from '../../../../../lib/validation';
import { overrideSignup, removeSignup } from '../../../../../lib/adminFlow';
import { SignupStatus } from '../../../../../sheets/schema';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ signupId: string }> };

const VALID_STATUSES: SignupStatus[] = ['confirmed', 'waitlisted', 'cancelled'];

/**
 * "Manually move someone between confirmed / waitlisted / cancelled"
 * (Section 8) — a direct override, unlike the player-facing cancel route.
 *
 * Validates and delegates. `overrideSignup` does the work and serializes
 * itself (see lib/adminFlow.ts). Validation stays here and stays outside the
 * lock: it needs nothing from the sheet, and a request that is going to 400
 * should not queue behind other mutations — or time out waiting for a lock it
 * never needed and come back as a 503 instead of the validation error the
 * caller earned.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { signupId } = await params;
    const body = await request.json().catch(() => ({}));

    if (body?.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
    }
    const fieldsProvided =
      body?.status !== undefined ||
      body?.paid !== undefined ||
      body?.amountPaid !== undefined ||
      body?.attended !== undefined;
    if (!fieldsProvided) {
      throw new ApiError(400, 'Provide at least one of: status, paid, amountPaid, attended.');
    }

    const signup = await overrideSignup(signupId, {
      status: body?.status,
      paid: body?.paid,
      amountPaid: body?.amountPaid !== undefined ? validateCost(body.amountPaid) : undefined,
      attended: body?.attended,
    });
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

    await removeSignup(signupId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
