import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { getSignup, updateSignup, deleteSignup, listSignupsForSession } from '../../../../../sheets/signups';
import { getSession } from '../../../../../sheets/sessions';
import { computeCostShare } from '../../../../../lib/signupFlow';
import { validateCost } from '../../../../../lib/validation';
import { activeRowsForEmail } from '../../../../../lib/adminRoster';
import { withMutationLock } from '../../../../../lib/lock';
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
 *
 * Runs under the global mutation lock, like every other write that changes
 * who holds a spot. Moving someone into 'confirmed' is a capacity decision,
 * and the duplicate check below reads the roster before deciding — without
 * the lock an override can race a player's own signup and oversubscribe the
 * week, or read a roster that a concurrent signup invalidates before the
 * write lands. The body is parsed outside the lock so no one waits on the
 * request stream while holding it.
 *
 * One of the last two handlers still acquiring the lock itself, for the same
 * reason as the admin session revision: the orchestration is here rather than
 * in a flow module, and the acquisition moves when it does.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { signupId } = await params;
    const body = await request.json().catch(() => ({}));

    // Validation first, and outside the lock: it needs nothing from the sheet,
    // and a request that is going to 400 should not queue behind other
    // mutations — or time out waiting for a lock it never needed and come back
    // as a 503 instead of the validation error the caller earned.
    if (body?.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
    }
    const explicitAmountPaid = body?.amountPaid !== undefined ? validateCost(body.amountPaid) : undefined;
    const fieldsProvided =
      body?.status !== undefined ||
      body?.paid !== undefined ||
      body?.amountPaid !== undefined ||
      body?.attended !== undefined;
    if (!fieldsProvided) {
      throw new ApiError(400, 'Provide at least one of: status, paid, amountPaid, attended.');
    }

    const signup = await withMutationLock(async () => {
      const existing = await getSignup(signupId);
      if (!existing) throw new ApiError(404, 'No such signup.');

      const updates: Partial<Signup> = {};

      // Both branches below may need this session's other rows. Read once and
      // reuse: all Sheets traffic shares one 60-reads-per-minute service-account
      // quota, so a route that reads the same tab twice costs twice as much of
      // it (see api/home/route.ts).
      let cachedSessionSignups: Signup[] | null = null;
      const sessionSignups = async () =>
        (cachedSessionSignups ??= await listSignupsForSession(existing.sessionId));

      if (body?.status !== undefined) {
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
          if (explicitAmountPaid !== undefined) {
            updates.amountPaid = explicitAmountPaid;
          } else {
            const session = await getSession(existing.sessionId);
            const signups = await sessionSignups();
            updates.amountPaid = session ? computeCostShare(session, signups)[signupId] ?? 0 : 0;
          }
          updates.paidAt = new Date().toISOString();
        }
      } else if (explicitAmountPaid !== undefined) {
        // Correcting the amount on an already-recorded payment.
        updates.amountPaid = explicitAmountPaid;
      }

      if (body?.attended !== undefined) {
        updates.attended = Boolean(body.attended);
      }

      return updateSignup(signupId, updates);
    });

    return NextResponse.json({ signup });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * "Manually add or remove a signup" (Section 8) — the remove half. Hard
 * delete, distinct from setting status to 'cancelled' via PATCH above.
 *
 * Under the same lock: removing a confirmed row frees a spot, and freeing a
 * spot is capacity accounting like any other.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { signupId } = await params;

    await withMutationLock(async () => {
      const existing = await getSignup(signupId);
      if (!existing) throw new ApiError(404, 'No such signup.');

      await deleteSignup(signupId);
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
