import { upsertPlayer } from '../sheets/players';
import { getSession, createSession, updateSession } from '../sheets/sessions';
import { getSignup, updateSignup, deleteSignup } from '../sheets/signups';
import { listSignupsForSession, batchUpdateSignups } from '../sheets/signups';
import { computeCostShare } from './payments';
import { activeRowsForEmail } from './adminRoster';
import { Session, Signup, SignupStatus } from '../sheets/schema';
import { signUpForSession, signUpAsGuestForSession, fillOpenSpots } from './signupFlow';
import { DEFAULT_GAME_TIME, DEFAULT_CAPACITY, DEFAULT_PRICE_PER_SPOT } from './scheduling';
import { ApiError } from './apiErrors';
import { validatePlayerProfile, validateInvitedByName, validateSessionCreate, validateReschedule } from './validation';
import { withMutationLock } from './lock';

export interface AdminAddSignupInput {
  sessionId: string;
  email: string;
  /** Only needed if this player has never signed up before (no Players row yet). */
  profile?: { fullName: string; gender: string; savedPositions?: string };
  /** Presence of invitedByName routes through the guest path, same as the player-facing route. */
  invitedByName?: string;
  willingToShare?: boolean;
  /** Required (Section 9) even for admin-added rows — the admin is
   * confirming this person consented, keeping the audit trail consistent
   * across every signup path rather than carving out a silent exception. */
  waiverAccepted: boolean;
}

/**
 * "Manually add a signup" (Section 8) — an organizer adding someone who
 * contacted them directly rather than using the app. Deliberately reuses
 * the same signUpForSession/signUpAsGuestForSession functions a player
 * would go through themselves, rather than a separate bypass path: this
 * keeps capacity accounting and duplicate-prevention intact even for
 * admin-added rows. The one thing this adds is the optional inline
 * profile upsert, so a first-time player can be added without already
 * having a Players row (which self-signup would reject as
 * PROFILE_REQUIRED).
 *
 * Judgment call, not spelled out in the guidelines: this does NOT bypass
 * the "session must be open" check, so an admin can't add someone to a
 * closed/cancelled/rained-out session. If that turns out to be wanted,
 * it's a small change here — flagging rather than assuming either way.
 */
export async function adminAddSignup(input: AdminAddSignupInput): Promise<Signup> {
  return withMutationLock(async () => {
    if (input.profile) {
      const profile = validatePlayerProfile(input.profile);
      await upsertPlayer({ email: input.email, ...profile });
    }

    // Section 8 lets an admin add someone regardless of the schedule — most
    // often *after* registration closes, which is exactly what the open-spots
    // alert nudges them to do. So this path opts out of the window check that
    // guards player-initiated signups; `status` still applies.
    const options = { bypassRegistrationWindow: true };

    if (input.invitedByName) {
      return signUpAsGuestForSession(
        input.sessionId,
        input.email,
        validateInvitedByName(input.invitedByName),
        Boolean(input.willingToShare),
        input.waiverAccepted,
        options
      );
    }
    return signUpForSession(input.sessionId, input.email, input.waiverAccepted, options);
  });
}

export interface AdminCreateSessionInput {
  gameDate: unknown;
  gameTime?: unknown;
  capacity?: unknown;
  cost?: unknown;
  pricePerSpot?: unknown;
  locationArea?: unknown;
  /** Opt in to opening registration immediately; otherwise created closed. */
  openImmediately?: boolean;
}

/**
 * "Create a session" (Section 8) — sessionId doubles as gameDate (see
 * sheets/sessions.ts), so this is really just createSession with
 * defaults filled in and gameDate/gameTime validated. Mainly for
 * scheduling a Saturday/Sunday game, or a Friday one ahead of the
 * Monday-open cron so an admin can set a non-default capacity/price from
 * the start rather than editing it in right after.
 *
 * Created **closed** by default. Signups are gated on `status` alone with no
 * date check, so creating a future session open meant anyone could
 * immediately sign up for it — months early, since session ids are just dates
 * and therefore guessable. The Monday 9am cron opens whichever session belongs
 * to the current week, which is the intended path; `openImmediately` is the
 * deliberate escape hatch (e.g. the cron failed and this week needs opening
 * now). See planner/2026-09-05-location-payments-qol-plan.md, §1.
 */
export async function adminCreateSession(input: AdminCreateSessionInput): Promise<Session> {
  return withMutationLock(async () => {
    const { gameDate, gameTime, capacity, cost, pricePerSpot, locationArea } = validateSessionCreate(input, {
      gameTime: DEFAULT_GAME_TIME,
      capacity: DEFAULT_CAPACITY,
      pricePerSpot: DEFAULT_PRICE_PER_SPOT,
    });

    const existing = await getSession(gameDate);
    if (existing) throw new ApiError(409, `A session for ${gameDate} already exists.`);

    return createSession({
      sessionId: gameDate,
      gameDate,
      gameTime,
      registrationOpensAt: '',
      registrationClosesAt: '',
      capacity,
      cost,
      pricePerSpot,
      locationArea,
      locationName: '',
      locationUrl: '',
      numFields: 1,
      teamsStatus: '',
      status: input.openImmediately ? 'open' : 'closed',
    });
  });
}

/**
 * Moving a session to a new date changes its identity — sessionId
 * *is* gameDate, the lookup key the homepage and the weekly cron jobs
 * use to find "this week's session" (see time.ts's
 * currentWeekGameDayCandidates). Renaming the existing row in place
 * (rather than create-new + delete-old) keeps this to one session-row
 * write; every signup referencing the old sessionId is then repointed
 * at the new one in the same pass so nothing orphans. Best-effort, not
 * a real transaction — Sheets has no cross-tab atomicity, same
 * trade-off already accepted throughout this codebase.
 */

export interface SignupOverride {
  status?: SignupStatus;
  paid?: boolean;
  /** Already validated by the caller when present. */
  amountPaid?: number;
  attended?: boolean;
}

/**
 * The organizer's direct override of one signup row — moving someone between
 * confirmed, waitlisted and cancelled, recording a payment, marking attendance.
 *
 * Deliberately does NOT run cancelMySignup's promotion cascade or email
 * notifications: an admin setting statuses by hand is already taking explicit
 * manual control of the roster, so those automated side effects would fight
 * the organizer's intent rather than help it.
 *
 * Serialized, because a status move is a capacity decision and the duplicate
 * check below reads the roster before deciding. Without the lock an override
 * can race a player's own signup and oversubscribe the week, or act on a
 * roster that a concurrent signup invalidates before the write lands.
 */
export async function overrideSignup(signupId: string, override: SignupOverride): Promise<Signup> {
  return withMutationLock(async () => {
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

    if (override.status !== undefined) {
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
      const reviving = existing.status === 'cancelled' && override.status !== 'cancelled';
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

      updates.status = override.status;
      // A status override invalidates any sub request on this row: the
      // request only made sense while this person was waitlisted, and
      // leaving it pending lets a later acceptance collapse an
      // already-confirmed player into someone else's slot (see
      // planner/2026-09-05-code-security-review.md, Bug 2).
      if (override.status !== 'waitlisted' && existing.subRequestStatus === 'pending') {
        Object.assign(updates, { subRequestTargetEmail: '', subRequestStatus: '' as const, subRequestedAt: '' });
      }
    }

    // Ticking "paid" records what was actually received and when, rather than
    // just a flag — that's the fact the organizer reconciles against an
    // e-Transfer history, and it survives the roster changing afterwards.
    // `amountPaid` can be given explicitly (a partial or unusual payment);
    // otherwise it defaults to what this person owed at the moment of ticking.
    if (override.paid !== undefined) {
      const paid = Boolean(override.paid);
      updates.paid = paid;
      if (!paid) {
        // Un-ticking clears the record — it was a mistake, not a refund.
        updates.amountPaid = 0;
        updates.paidAt = '';
      } else {
        if (override.amountPaid !== undefined) {
          updates.amountPaid = override.amountPaid;
        } else {
          const session = await getSession(existing.sessionId);
          const signups = await sessionSignups();
          updates.amountPaid = session ? computeCostShare(session, signups)[signupId] ?? 0 : 0;
        }
        updates.paidAt = new Date().toISOString();
      }
    } else if (override.amountPaid !== undefined) {
      // Correcting the amount on an already-recorded payment.
      updates.amountPaid = override.amountPaid;
    }

    if (override.attended !== undefined) {
      updates.attended = Boolean(override.attended);
    }

    return updateSignup(signupId, updates);
  });
}

/**
 * Removes a signup row outright — the organizer's "remove a signup", distinct
 * from setting its status to 'cancelled'.
 *
 * Under the same lock: freeing a confirmed row frees a spot, and that is
 * capacity accounting like any other.
 */
export async function removeSignup(signupId: string): Promise<void> {
  return withMutationLock(async () => {
    const existing = await getSignup(signupId);
    if (!existing) throw new ApiError(404, 'No such signup.');

    await deleteSignup(signupId);
  });
}

export interface SessionRevision {
  /** Already validated by the caller — the route rejects bad input before any
   * lock is taken, so a request that is going to 400 never queues. */
  updates: Partial<Session>;
  /** Present only when the organizer is moving the game. */
  gameDate?: string;
  gameTime?: string;
}

/**
 * Applies one organizer edit to a session: a reschedule, field updates, and
 * the waitlist promotion that a raised capacity has to trigger.
 *
 * All of it under a single hold. Capacity used to be written between two
 * separate acquisitions, which left a window where a signup could read the
 * raised capacity as "there is room" before the cascade that acts on it had
 * run, and oversubscribe the week. One acquisition has no such window, and a
 * reschedule can no longer be observed half-applied.
 *
 * A gameDate change goes first, because it can rekey the row and cascade every
 * signup's sessionId (see adminRescheduleSession) — so the field updates after
 * it have to land on whatever id the session ends up with.
 *
 * The cost is a long critical section: worst case a rekey (~5 Sheets calls),
 * the field write, and the cascade (3 + one per promoted player) under one
 * hold. With up to 7s of backoff per call under rate limiting (client.ts,
 * RATE_LIMIT_RETRY_DELAYS_MS), this is the flow most likely to approach
 * LOCK_TTL_SECONDS, and the first place to look if that ceiling needs raising.
 */
export async function reviseSession(
  sessionId: string,
  existing: Session,
  revision: SessionRevision
): Promise<{ session: Session; promoted: Signup[] }> {
  return withMutationLock(async () => {
    let session = existing;
    let currentSessionId = sessionId;

    if (revision.gameDate !== undefined || revision.gameTime !== undefined) {
      session = await adminRescheduleSession(
        sessionId,
        revision.gameDate ?? existing.gameDate,
        revision.gameTime ?? existing.gameTime
      );
      currentSessionId = session.sessionId;
    }

    if (Object.keys(revision.updates).length > 0) {
      session = await updateSession(currentSessionId, revision.updates);
    }

    // Raising capacity is how the organizer opens a second field, so it has to
    // actually let people in. Without this the new spots stay empty and
    // everyone above the old capacity keeps waiting.
    const promoted =
      revision.updates.capacity !== undefined && revision.updates.capacity > existing.capacity
        ? await fillOpenSpots(currentSessionId)
        : [];

    return { session, promoted };
  });
}

export async function adminRescheduleSession(sessionId: string, newGameDate: unknown, newGameTime: unknown): Promise<Session> {
  return withMutationLock(async () => {
    const { gameDate, gameTime } = validateReschedule(newGameDate, newGameTime);

    const existing = await getSession(sessionId);
    if (!existing) throw new ApiError(404, 'No such session.');

    if (gameDate === sessionId) {
      // Same identity — a pure time change (or a no-op date), no rekey needed.
      return updateSession(sessionId, { gameDate, gameTime });
    }

    const conflict = await getSession(gameDate);
    if (conflict) throw new ApiError(409, `A session for ${gameDate} already exists.`);

    const updated = await updateSession(sessionId, { sessionId: gameDate, gameDate, gameTime });

    const signups = await listSignupsForSession(sessionId);
    if (signups.length > 0) {
      await batchUpdateSignups(signups.map((s) => ({ signupId: s.signupId, updates: { sessionId: gameDate } })));
    }

    return updated;
  });
}
