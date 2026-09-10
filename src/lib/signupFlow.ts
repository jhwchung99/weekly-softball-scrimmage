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
import { isWithinPromotionCutoff, getWeeklyMilestones } from './time';
import { normalizeEmail } from './email';
import { countConfirmedSlots, computeCostShare } from './payments';

// Moved to lib/payments.ts so client components can share the implementation;
// re-exported here because this has been their import site all along.
export { countConfirmedSlots, computeCostShare, computePaymentSummary } from './payments';
import { sendPromotionEmail, sendLateCancellationAlert, sendGuestPairRequestEmail } from './notifications';
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
  return countConfirmedSlots(existing) < capacity ? 'confirmed' : 'waitlisted';
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

function formatEastern(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function requireOpenSessionAndProfile(sessionId: string, email: string, options: SignupOptions = {}) {
  const session = await getSession(sessionId);
  if (!session) throw new ApiError(404, 'No such session.');
  if (session.status !== 'open') {
    throw new ApiError(409, 'Registration is not currently open for this session.');
  }

  // `status` alone used to be the entire gate, which made it a single point
  // of failure: anything that set a session open — a stray script run, a
  // hand-edited cell, a mistimed cron — accepted signups immediately, and
  // sessionIds are guessable dates. The schedule is computed from the game
  // date, so it can disagree with a wrong status and win. See the 2026-09-07
  // "was registration open before Monday 9am" investigation.
  if (!options.bypassRegistrationWindow) {
    const now = options.now ?? new Date();
    const { registrationOpensAt, registrationClosesAt } = getWeeklyMilestones(session.gameDate, session.gameTime);
    if (now < registrationOpensAt) {
      throw new ApiError(409, `Registration for this session opens ${formatEastern(registrationOpensAt)} ET.`);
    }
    if (now >= registrationClosesAt) {
      throw new ApiError(409, `Registration for this session closed ${formatEastern(registrationClosesAt)} ET.`);
    }
  }

  const player = await getPlayer(email);
  if (!player) {
    throw new ApiError(428, 'PROFILE_REQUIRED: complete your player profile before signing up.');
  }

  const existingActive = await findActiveSignup(sessionId, email);
  if (existingActive) {
    // Exact wording from PROJECT_GUIDELINES.md Section 4.
    throw new ApiError(409, "You're already signed up for this week");
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
  try {
    await sendGuestPairRequestEmail(member, updated, session);
  } catch (err) {
    console.error(`Failed to send guest pair request email for signup ${guest.signupId}:`, err);
  }
  return updated;
}

/**
 * Whether a pairing can be offered at all. The guest must be waitlisted:
 * one who already has their own confirmed slot gains nothing from sharing,
 * and folding them into someone else's slot would drop the roster under
 * capacity with no promotion to refill it — the same reason
 * respondToSubRequest refuses a requester who isn't waitlisted.
 */
function canProposePair(guest: Signup, member: Signup | null): member is Signup {
  return Boolean(
    member &&
      !member.pairId &&
      member.status !== 'cancelled' &&
      guest.status === 'waitlisted' &&
      !guest.pairId &&
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
 * shared slot, only that one is attempted if the named member has already
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

    // Always their own slot, decided by capacity like anyone else's. Naming a
    // member no longer short-circuits this into that member's slot.
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

// Section 6 promotion order: 1) members, 2) sharing-willing guests, 3) other guests.
function tierOf(s: Signup): number {
  if (s.memberStatus === 'member') return 0;
  return s.willingToShare ? 1 : 2;
}

interface WaitlistUnit {
  signupIds: string[];
  tier: number;
  timestamp: string; // earliest of the group, for FIFO
}

/**
 * Waitlisted rows to consider for promotion, grouped so a waitlisted pair
 * is promoted together (both flip to 'confirmed' as one unit, since they
 * share one slot) rather than as two independent candidates.
 *
 * Judgment call: a pairId with ANY row already 'confirmed' is excluded
 * entirely — that pair already has its slot via the other partner, so the
 * waitlisted row is just along for the ride, not actually waiting for
 * anything. Section 5/6 don't address a pair split across statuses
 * directly (possible when a guest and member signed up independently
 * before merging), so this is the interpretation taken.
 */
function groupWaitlistUnits(allSignupsForSession: Signup[]): WaitlistUnit[] {
  const waitlisted = allSignupsForSession.filter((s) => s.status === 'waitlisted');
  const confirmedPairIds = new Set(
    allSignupsForSession.filter((s) => s.status === 'confirmed' && s.pairId).map((s) => s.pairId)
  );

  const units: WaitlistUnit[] = [];
  const byPairId = new Map<string, Signup[]>();

  for (const s of waitlisted) {
    if (!s.pairId) {
      units.push({ signupIds: [s.signupId], tier: tierOf(s), timestamp: s.timestamp });
      continue;
    }
    if (confirmedPairIds.has(s.pairId)) continue; // partner already confirmed elsewhere
    if (!byPairId.has(s.pairId)) byPairId.set(s.pairId, []);
    byPairId.get(s.pairId)!.push(s);
  }

  for (const group of byPairId.values()) {
    const memberRow = group.find((s) => s.memberStatus === 'member');
    const tier = memberRow ? 0 : Math.min(...group.map(tierOf));
    const timestamp = group.reduce((min, s) => (s.timestamp < min ? s.timestamp : min), group[0].timestamp);
    units.push({ signupIds: group.map((s) => s.signupId), tier, timestamp });
  }

  return units;
}

/**
 * Promotes the single highest-priority waitlisted unit to 'confirmed', if
 * any, and returns every signup in that unit — a promoted pair is 1-2
 * rows, and every one of them needs to actually get the "you're in"
 * email, not just the first (a real gap found while building sub
 * requests: this used to return only winner.signupIds[0], so the second
 * member of any promoted pair never got notified).
 */
function nextWaitlistUnit(allSignupsForSession: Signup[]): WaitlistUnit | null {
  const units = groupWaitlistUnits(allSignupsForSession);
  if (units.length === 0) return null;
  units.sort((a, b) => a.tier - b.tier || a.timestamp.localeCompare(b.timestamp));
  return units[0];
}

async function promoteNextWaitlisted(allSignupsForSession: Signup[]): Promise<Signup[]> {
  const winner = nextWaitlistUnit(allSignupsForSession);
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
 * or the pair's slot (Section 5) — this just updates the one row being
 * cancelled. Whether that actually freed a confirmed slot is determined
 * by comparing countConfirmedSlots before/after, not by looking at the
 * cancelled row's own status — that's what makes "both partners must be
 * out" fall out for free instead of needing special-case logic.
 *
 * If a slot was freed and we're not within the 5-hour cutoff (Section 6),
 * promotes the next eligible waitlisted person/pair. Exactly one
 * promotion per call is always correct here, since even a full pair
 * drop-out only ever frees one slot (a pair only ever consumed one).
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

    const before = countConfirmedSlots(sessionSignups);
    // Captured before the status flips: computeCostShare only counts confirmed
    // rows, so afterwards this person's share would read as 0.
    const owedAtCancellation = computeCostShare(session, sessionSignups)[signupId] ?? 0;
    await updateSignupStatus(signupId, 'cancelled');
    const afterSignups = await listSignupsForSession(signup.sessionId);
    const after = countConfirmedSlots(afterSignups);

    // Sub-request cleanup: this signup's own outgoing request (if any) and
    // anyone else's pending request that was targeting this now-cancelled
    // signup's email both become moot.
    await clearOwnPendingRequest(signup);
    await clearPendingRequestsTargeting(signup.email, afterSignups, signupId);

    if (after >= before) return { promoted: [] }; // no slot actually freed
    if (isWithinPromotionCutoff(session.gameDate, session.gameTime)) {
      // Section 6/7: no auto-promotion this close to game time, but the
      // organizer needs to know a slot just opened so they can personally
      // text someone. Same awaited-but-swallowed pattern as the promotion
      // email below — a failed push shouldn't affect the cancellation.
      try {
        await sendLateCancellationAlert(signup, session, owedAtCancellation);
      } catch (err) {
        console.error(`Failed to send organizer alert for cancelled signup ${signup.signupId}:`, err);
      }
      return { promoted: [] };
    }

    const promotedSignups = await promoteNextWaitlisted(afterSignups);
    for (const promoted of promotedSignups) {
      // A promoted signup's own outstanding outgoing sub request is moot —
      // it just got its own slot.
      await clearOwnPendingRequest(promoted);
      // Awaited, not fire-and-forget: on Vercel's serverless runtime, an
      // unawaited promise can get killed once the response is sent, so
      // "don't block on this" has to mean "swallow the error," not "don't
      // await it." Either way, the promotion itself already succeeded in
      // the sheet — a failed email shouldn't undo that or surface as an
      // error to whoever triggered the cancellation.
      try {
        await sendPromotionEmail(promoted, session);
      } catch (err) {
        console.error(`Failed to send promotion email to ${promoted.email}:`, err);
      }
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
 * raising it, so it has to cascade. See
 * planner/2026-09-07-team-generation-plan.md.
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

    while (countConfirmedSlots(signups) < session.capacity) {
      const winner = nextWaitlistUnit(signups);
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
      try {
        await sendPromotionEmail(p, session);
      } catch (err) {
        console.error(`Failed to send promotion email to ${p.email}:`, err);
      }
    }
    return promoted;
  });
}

export interface MyStatus {
  signup: Signup | null;
  /** Other players' pending requests to share a slot with this caller.
   * `fromGuestInvite` distinguishes a guest who named this caller as their
   * inviter from a waitlisted player asking to sub in — accepting means the
   * same thing mechanically, but the member is owed an accurate description
   * of what they're agreeing to. */
  incomingSubRequests: { fromSignupId: string; fromFullName: string; fromGuestInvite: boolean }[];
  /** This caller's own share of session.cost, or null if not priced yet
   * or the caller isn't confirmed. */
  costOwed: number | null;
  /** 1-based place in the waitlist queue, or null when not waitlisted.
   * Computed server-side so it's still correct for a player who can't see the
   * roster list itself (the roster hides names from non-participants). */
  waitlistPosition: number | null;
}

/**
 * The computation behind getMyStatusForSession, with the fetching lifted out
 * so a caller that already holds the session and its signups — the
 * consolidated /api/home route — can reuse them instead of reading the same
 * two tabs again. Pure.
 */
export function buildMyStatus(session: Session | null, allSignups: Signup[], email: string): MyStatus {
  const normalized = normalizeEmail(email);

  const signup = allSignups.find((s) => normalizeEmail(s.email) === normalized && s.status !== 'cancelled') ?? null;

  const incomingSubRequests = allSignups
    .filter((s) => s.subRequestStatus === 'pending' && normalizeEmail(s.subRequestTargetEmail) === normalized)
    .map((s) => ({
      fromSignupId: s.signupId,
      fromFullName: s.fullName,
      fromGuestInvite: s.memberStatus === 'guest' && s.willingToShare,
    }));

  let costOwed: number | null = null;
  if (signup && signup.status === 'confirmed' && session) {
    costOwed = computeCostShare(session, allSignups)[signup.signupId] ?? null;
  }

  // Position among waitlisted rows in signup order. Counts rows rather than
  // promotion units, so it answers "how many people are ahead of me" — the
  // question a player is actually asking. Promotion order additionally
  // considers member/guest tiering (see groupWaitlistUnits), so this is a
  // good-faith indicator rather than a promise about who moves up next.
  let waitlistPosition: number | null = null;
  if (signup && signup.status === 'waitlisted') {
    const queue = allSignups
      .filter((s) => s.status === 'waitlisted')
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const index = queue.findIndex((s) => s.signupId === signup.signupId);
    waitlistPosition = index >= 0 ? index + 1 : null;
  }

  return { signup, incomingSubRequests, costOwed, waitlistPosition };
}

/**
 * Everything the player homepage needs about "me" for this session, fetching
 * the session and its signups once each.
 */
export async function getMyStatusForSession(sessionId: string, email: string): Promise<MyStatus> {
  const [allSignups, session] = await Promise.all([listSignupsForSession(sessionId), getSession(sessionId)]);
  return buildMyStatus(session, allSignups, email);
}
