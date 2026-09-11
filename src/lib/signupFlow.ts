import { getSession } from '../sheets/sessions';
import {
  createSignup,
  findActiveSignup,
  findMemberSignupByName,
  findPendingGuestInvite,
  getSignupWithSessionSignups,
  listSignupsForSession,
  updateSignup,
  updateSignupStatus,
  batchUpdateSignups,
} from '../sheets/signups';
import { getPlayer } from '../sheets/players';
import { Signup, Session } from '../sheets/schema';
import { ApiError } from './apiErrors';
import { getWeeklyMilestones, formatEasternMoment } from './time';
import { phaseOf, isRegistrationOpen, isRosterLocked } from './sessionPhase';
import { isPaired } from './pair';
import { nextInLine } from './waitlist';
import { normalizeEmail } from './email';
import { countConfirmedSpots, computeCostShare } from './payments';

import { sendPromotionEmail, sendLateCancellationAlert, sendGuestPairRequestEmail, deliver } from './notifications';
import { WAIVER_TEXT } from './waiver';
import { clearOwnPendingRequest, clearPendingRequestsTargeting } from './subRequestFlow';
import { withMutationLock } from './lock';

function requireWaiver(waiverAccepted: boolean) {
  if (!waiverAccepted) {
    throw new ApiError(400, 'You must accept the waiver to sign up.');
  }
}

/** Every new signup starts with no payment tracked and no sub request
 * outstanding — spread into every createSignup call below. */
const NEW_SIGNUP_EXTRAS = {
  paid: false,
  amountPaid: 0,
  paidAt: '',
  attended: false,
  subRequestTargetEmail: '',
  subRequestStatus: '' as const,
  subRequestedAt: '',
  teamName: '',
};

async function computeCapacityStatus(sessionId: string, capacity: number): Promise<'confirmed' | 'waitlisted'> {
  const existing = await listSignupsForSession(sessionId);
  return countConfirmedSpots(existing) < capacity ? 'confirmed' : 'waitlisted';
}

export interface SignupOptions {
  /**
   * Skips the registration-window check. For admin manual adds only
   * (Section 8), which are explicitly allowed outside the window — it's
   * what the open-spots alert exists to prompt.
   */
  bypassRegistrationWindow?: boolean;
  now?: Date;
}

async function requireOpenSessionAndProfile(sessionId: string, email: string, options: SignupOptions = {}) {
  const session = await getSession(sessionId);
  if (!session) throw new ApiError(404, 'No such session.');
  if (session.status !== 'open') {
    throw new ApiError(409, "Signups aren't open for this week.");
  }

  // `status` alone used to be the entire gate, which made it a single point
  // of failure: anything that set a session open — a stray script run, a
  // hand-edited cell, a mistimed cron — accepted signups immediately, and
  // sessionIds are guessable dates. The schedule is computed from the game
  // date, so it can disagree with a wrong status and win. See the 2026-09-07
  // "was registration open before Monday 9am" investigation.
  if (!options.bypassRegistrationWindow) {
    const now = options.now ?? new Date();
    if (!isRegistrationOpen(phaseOf(session, now))) {
      // The milestones are still read here, but only to say *when* — the
      // decision itself is the phase module's.
      const { registrationOpensAt, registrationClosesAt } = getWeeklyMilestones(session.gameDate, session.gameTime);
      throw new ApiError(
        409,
        now < registrationOpensAt
          ? `Signups for this week open ${formatEasternMoment(registrationOpensAt)} ET.`
          : `Signups for this week closed ${formatEasternMoment(registrationClosesAt)} ET.`
      );
    }
  }

  const player = await getPlayer(email);
  if (!player) {
    throw new ApiError(428, 'Fill in your player profile before signing up.');
  }

  const existingActive = await findActiveSignup(sessionId, email);
  if (existingActive) {
    // Exact wording from PROJECT_GUIDELINES.md Section 4.
    throw new ApiError(409, "You're already signed up for this week.");
  }

  return { session, player };
}

/**
 * Offers `member` the chance to share their spot with `guest`, instead of
 * merging the two on the spot.
 *
 * Pairing used to happen the instant a guest typed a member's name, which
 * meant anyone could take a confirmed spot by naming a member off the
 * roster: the guest inherited that member's status, jumped the whole
 * waitlist, silently halved the member's bill, and the capacity numbers
 * still looked right. Names are user-supplied, non-unique and editable, so
 * they cannot stand in for consent. This routes the pairing through the
 * same pending/accept/decline mechanism as a sub request, which the member
 * already sees on the homepage. A wrong name now sends someone a request
 * they can decline, rather than handing away their spot.
 */
async function proposeGuestPair(guest: Signup, member: Signup, session: Session): Promise<Signup> {
  const updated = await updateSignup(guest.signupId, {
    subRequestTargetEmail: member.email,
    subRequestStatus: 'pending',
    subRequestedAt: new Date().toISOString(),
  });

  // Same awaited-but-swallowed pattern as the promotion mail: the request
  // itself already succeeded, and a mail failure shouldn't undo it.
  await deliver(`guest pair request email for signup ${guest.signupId}`, () =>
    sendGuestPairRequestEmail(member, updated, session)
  );
  return updated;
}

/**
 * Whether a pairing can be offered at all. The guest must be waitlisted:
 * one who already has their own confirmed spot gains nothing from sharing,
 * and folding them into someone else's spot would drop the roster under
 * capacity with no promotion to refill it — the same reason
 * respondToSubRequest refuses a requester who isn't waitlisted.
 */
function canProposePair(guest: Signup, member: Signup | null): member is Signup {
  return Boolean(
    member &&
      !isPaired(member) &&
      member.status !== 'cancelled' &&
      guest.status === 'waitlisted' &&
      !isPaired(guest) &&
      guest.subRequestStatus !== 'pending' &&
      normalizeEmail(member.email) !== normalizeEmail(guest.email)
  );
}

/** A member signing up for themselves. `waiverAccepted` is required
 * (Section 9) — every signup, no exceptions, needs an explicit yes. */
export async function signUpForSession(
  sessionId: string,
  email: string,
  waiverAccepted: boolean,
  options: SignupOptions = {}
): Promise<Signup> {
  return withMutationLock(async () => {
    requireWaiver(waiverAccepted);
    const { session, player } = await requireOpenSessionAndProfile(sessionId, email, options);
    const status = await computeCapacityStatus(sessionId, session.capacity);

    const created = await createSignup({
      sessionId,
      email,
      fullName: player.fullName,
      gender: player.gender,
      memberStatus: 'member',
      invitedByName: '',
      willingToShare: false,
      pairId: '',
      status,
      timestamp: new Date().toISOString(),
      positions: player.savedPositions,
      waiverAcceptedAt: new Date().toISOString(),
      waiverText: WAIVER_TEXT,
      ...NEW_SIGNUP_EXTRAS,
    });

    // Section 5: a guest may already have named this member as their inviter.
    // That used to merge the two rows on the spot. It now only *offers* the
    // pairing: the member is the one giving up sole use of their spot, and
    // nobody asked them. See proposeGuestPair.
    const pendingGuest = await findPendingGuestInvite(sessionId, player.fullName);
    if (pendingGuest && canProposePair(pendingGuest, created)) {
      await proposeGuestPair(pendingGuest, created, session);
    }

    return created;
  });
}

/**
 * A guest signing up. `invitedByName` is required; `willingToShare` drives
 * the pairing behavior from Section 5 — it does not by itself guarantee a
 * shared spot, only that one is attempted if the named member has already
 * signed up (and isn't already paired with someone else).
 */
export async function signUpAsGuestForSession(
  sessionId: string,
  email: string,
  invitedByName: string,
  willingToShare: boolean,
  waiverAccepted: boolean,
  options: SignupOptions = {}
): Promise<Signup> {
  return withMutationLock(async () => {
    requireWaiver(waiverAccepted);
    if (!invitedByName.trim()) {
      throw new ApiError(400, 'invitedByName is required for a guest signup.');
    }

    const { session, player } = await requireOpenSessionAndProfile(sessionId, email, options);
    const waiverFields = { waiverAcceptedAt: new Date().toISOString(), waiverText: WAIVER_TEXT };

    // Always their own spot, decided by capacity like anyone else's. Naming a
    // member no longer short-circuits this into that member's spot.
    const status = await computeCapacityStatus(sessionId, session.capacity);
    const created = await createSignup({
      sessionId,
      email,
      fullName: player.fullName,
      gender: player.gender,
      memberStatus: 'guest',
      invitedByName,
      willingToShare,
      pairId: '',
      status,
      timestamp: new Date().toISOString(),
      positions: player.savedPositions,
      ...waiverFields,
      ...NEW_SIGNUP_EXTRAS,
    });

    // Only worth offering when the guest didn't get in on their own.
    if (willingToShare) {
      const memberSignup = await findMemberSignupByName(sessionId, invitedByName);
      if (canProposePair(created, memberSignup)) {
        return proposeGuestPair(created, memberSignup, session);
      }
    }

    return created;
  });
}

async function promoteNextWaitlisted(allSignupsForSession: Signup[]): Promise<Signup[]> {
  const winner = nextInLine(allSignupsForSession);
  if (!winner) return [];
  // One batched call both confirms every row in the winning unit and
  // returns the updated rows — previously a loop of individual writes
  // followed by a loop of individual reads.
  return batchUpdateSignups(winner.signupIds.map((id) => ({ signupId: id, updates: { status: 'confirmed' as const } })));
}

export interface CancelResult {
  /** Everyone promoted as a result of this cancellation — empty if no one was. */
  promoted: Signup[];
}

/**
 * Either partner in a pair can cancel without affecting the other's row
 * or the pair's spot (Section 5) — this just updates the one row being
 * cancelled. Whether that actually freed a confirmed spot is determined
 * by comparing countConfirmedSpots before/after, not by looking at the
 * cancelled row's own status — that's what makes "both partners must be
 * out" fall out for free instead of needing special-case logic.
 *
 * If a spot was freed and we're not within the 5-hour cutoff (Section 6),
 * promotes the next eligible waitlisted person/pair. Exactly one
 * promotion per call is always correct here, since even a full pair
 * drop-out only ever frees one spot (a pair only ever consumed one).
 * If that promoted person later cancels too, that cancellation triggers
 * this same function again — which is what makes "cascade until someone
 * confirms" (Section 6) work, without needing a response-tracking loop.
 */
export async function cancelMySignup(
  signupId: string,
  requesterEmail: string,
  requesterIsAdmin: boolean
): Promise<CancelResult> {
  return withMutationLock(async () => {
    // One read serves both "find this signup" and "current session
    // headcount" — previously a separate getSignup then
    // listSignupsForSession, each a full-tab read.
    const { signup, sessionSignups } = await getSignupWithSessionSignups(signupId);
    if (!signup) throw new ApiError(404, 'No such signup.');
    if (normalizeEmail(signup.email) !== normalizeEmail(requesterEmail) && !requesterIsAdmin) {
      throw new ApiError(403, 'You can only cancel your own signup.');
    }
    if (signup.status === 'cancelled') return { promoted: [] }; // already cancelled, nothing to do

    const session = await getSession(signup.sessionId);
    if (!session) throw new ApiError(404, 'No such session.');

    const before = countConfirmedSpots(sessionSignups);
    // Captured before the status flips: computeCostShare only counts confirmed
    // rows, so afterwards this person's share would read as 0.
    const owedAtCancellation = computeCostShare(session, sessionSignups)[signupId] ?? 0;
    await updateSignupStatus(signupId, 'cancelled');
    const afterSignups = await listSignupsForSession(signup.sessionId);
    const after = countConfirmedSpots(afterSignups);

    // Sub-request cleanup: this signup's own outgoing request (if any) and
    // anyone else's pending request that was targeting this now-cancelled
    // signup's email both become moot.
    await clearOwnPendingRequest(signup);
    await clearPendingRequestsTargeting(signup.email, afterSignups, signupId);

    if (after >= before) return { promoted: [] }; // no spot actually freed
    if (isRosterLocked(phaseOf(session))) {
      // Section 6/7: no auto-promotion this close to game time, but the
      // organizer needs to know a spot just opened so they can personally
      // text someone. Same awaited-but-swallowed pattern as the promotion
      // email below — a failed push shouldn't affect the cancellation.
      await deliver(`organizer alert for cancelled signup ${signup.signupId}`, () => sendLateCancellationAlert(signup, session, owedAtCancellation));
      return { promoted: [] };
    }

    const promotedSignups = await promoteNextWaitlisted(afterSignups);
    for (const promoted of promotedSignups) {
      // A promoted signup's own outstanding outgoing sub request is moot
      // it just got its own spot.
      await clearOwnPendingRequest(promoted);
      // Awaited, not fire-and-forget: on Vercel's serverless runtime, an
      // unawaited promise can get killed once the response is sent, so
      // "don't block on this" has to mean "swallow the error," not "don't
      // await it." Either way, the promotion itself already succeeded in
      // the sheet — a failed email shouldn't undo that or surface as an
      // error to whoever triggered the cancellation.
      await deliver(`promotion email to ${promoted.email}`, () => sendPromotionEmail(promoted, session));
    }
    return { promoted: promotedSignups };
  });
}


/**
 * Promotes waitlisted players until the roster reaches capacity or the
 * waitlist runs out, and returns everyone who moved.
 *
 * Raising capacity used to promote nobody: the admin route wrote the new
 * number straight through and nothing re-examined the waitlist, so anyone
 * above the old capacity stayed waitlisted indefinitely and only trickled in
 * as a side effect of other people cancelling. That is the whole point of
 * raising it, so it has to cascade.
 *
 * The whole cascade is worked out in memory first, so this costs one read and
 * one batched write however many spots just opened, rather than a read and a
 * write per person.
 */
export async function fillOpenSpots(sessionId: string): Promise<Signup[]> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');

    let signups = await listSignupsForSession(sessionId);
    const toConfirm: string[] = [];

    while (countConfirmedSpots(signups) < session.capacity) {
      const winner = nextInLine(signups);
      if (!winner) break;
      toConfirm.push(...winner.signupIds);
      signups = signups.map((s) =>
        winner.signupIds.includes(s.signupId) ? { ...s, status: 'confirmed' as const } : s
      );
    }

    if (toConfirm.length === 0) return [];

    const promoted = await batchUpdateSignups(
      toConfirm.map((signupId) => ({ signupId, updates: { status: 'confirmed' as const } }))
    );

    for (const p of promoted) {
      await clearOwnPendingRequest(p);
      await deliver(`promotion email to ${p.email}`, () => sendPromotionEmail(p, session));
    }
    return promoted;
  });
}
