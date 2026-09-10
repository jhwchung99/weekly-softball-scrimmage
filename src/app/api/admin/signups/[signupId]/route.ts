import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { validateSignupOverride } from '../../../../../lib/validation';
import { overrideSignup, removeSignup } from '../../../../../lib/adminFlow';
import { handleApiError } from '../../../../../lib/apiErrors';
import { adminRosterView } from '../../../../../lib/views';

type Params = { params: Promise<{ signupId: string }> };

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

    const updated = await overrideSignup(signupId, validateSignupOverride(body));
    return NextResponse.json({ signup: adminRosterView([updated])[0] });
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
