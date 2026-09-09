import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSignup, updateSignup, deleteSignup, listSignupsForSession } from '../../../../../sheets/signups';
import { getSession } from '../../../../../sheets/sessions';
import { computeCostShare } from '../../../../../lib/signupFlow';
import { validateCost } from '../../../../../lib/validation';
import { activeRowsForEmail } from '../../../../../lib/adminRoster';
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

    // Both branches below may need this session's other rows. Read once and
    // reuse: all Sheets traffic shares one 60-reads-per-minute service-account
    // quota, so a route that reads the same tab twice costs twice as much of
    // it (see api/home/route.ts).
    let cachedSessionSignups: Signup[] | null = null;
    const sessionSignups = async () =>
      (cachedSessionSignups ??= await listSignupsForSession(existing.sessionId));

    if (body?.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
      }

      /**
       * Bringing a cancelled row back is the one status move that can put the
       * same person on the roster twice.
       *
       * It is an easy mistake to make from the dashboard: someone who cancels
       * and signs up again leaves a stale cancelled row behind, and setting
       * that one back to 'confirmed' looks like undoing a cancellation. It
       * isn't — their real row is already there, and the result is a person
       * holding two capacity slots, billed twice by computeCostShare, counted
       * twice in the roster, and sent two of every email. Nothing downstream
       * would flag it, because everything downstream trusts that a person has
       * at most one active row.
       *
       * createSignup enforces that on the signup path. This is the same rule
       * on the override path, which never had it.
       *
       * Checked only on cancelled -> active: an already-active row moving
       * between confirmed and waitlisted creates no new duplicate, and
       * blocking it would get in the way of repairing a roster that is already
       * in this state. Cancelling is always allowed, which is how the repair
       * is done.
       */
      const reviving = existing.status === 'cancelled' && body.status !== 'cancelled';
      if (reviving) {
        const [conflict] = activeRowsForEmail(await sessionSignups(), existing.email).filter(
          (s) => s.signupId !== signupId
        );
        if (conflict) {
          throw new ApiError(
            409,
            `${existing.fullName || existing.email} already has an active signup for this session (${conflict.status}). ` +
              'Cancel or remove that row first, or leave this one cancelled — it is the record of a signup they already withdrew.'
          );
        }
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
          const signups = await sessionSignups();
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
