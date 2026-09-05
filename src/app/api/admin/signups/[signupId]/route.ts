import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSignup, updateSignup, deleteSignup, listSignupsForSession } from '../../../../../sheets/signups';
import { getSession } from '../../../../../sheets/sessions';
import { computeCostShare } from '../../../../../lib/signupFlow';
import { validateCost } from '../../../../../lib/validation';
import { Signup, SignupStatus } from '../../../../../sheets/schema';
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
    const updates: Partial<Signup> = {};

    if (body?.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
      }
      updates.status = body.status;
      // A status override invalidates any sub request on this row: the
      // request only made sense while this person was waitlisted, and
      // leaving it pending lets a later acceptance collapse an
      // already-confirmed player into someone else's slot (see
      // planner/2026-09-05-code-security-review.md, Bug 2).
      if (body.status !== 'waitlisted' && existing.subRequestStatus === 'pending') {
        Object.assign(updates, { subRequestTargetEmail: '', subRequestStatus: '' as const, subRequestedAt: '' });
      }
    }

    // Ticking "paid" records what was actually received and when, rather than
    // just a flag — that's the fact the organizer reconciles against an
    // e-Transfer history, and it survives the roster changing afterwards.
    // `amountPaid` can be given explicitly (a partial or unusual payment);
    // otherwise it defaults to what this person owed at the moment of ticking.
    if (body?.paid !== undefined) {
      const paid = Boolean(body.paid);
      updates.paid = paid;
      if (!paid) {
        // Un-ticking clears the record — it was a mistake, not a refund.
        updates.amountPaid = 0;
        updates.paidAt = '';
      } else {
        const explicit = body?.amountPaid !== undefined ? validateCost(body.amountPaid) : undefined;
        if (explicit !== undefined) {
          updates.amountPaid = explicit;
        } else {
          const session = await getSession(existing.sessionId);
          const signups = await listSignupsForSession(existing.sessionId);
          updates.amountPaid = session ? computeCostShare(session, signups)[signupId] ?? 0 : 0;
        }
        updates.paidAt = new Date().toISOString();
      }
    } else if (body?.amountPaid !== undefined) {
      // Correcting the amount on an already-recorded payment.
      updates.amountPaid = validateCost(body.amountPaid);
    }

    if (body?.attended !== undefined) {
      updates.attended = Boolean(body.attended);
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'Provide at least one of: status, paid, amountPaid, attended.');
    }

    const signup = await updateSignup(signupId, updates);
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
