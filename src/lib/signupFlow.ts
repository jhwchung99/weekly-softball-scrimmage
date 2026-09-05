import { randomUUID } from 'node:crypto';
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
import { isWithinPromotionCutoff } from './time';
import { sendPromotionEmail, sendLateCancellationAlert } from './notifications';
import { WAIVER_TEXT } from './waiver';
import { clearOwnPendingRequest, clearPendingRequestsTargeting } from './subRequestFlow';

function requireWaiver(waiverAccepted: boolean) {
  if (!waiverAccepted) {
    throw new ApiError(400, 'You must accept the waiver to sign up.');
  }
}

/** Every new signup starts with no payment tracked and no sub request
 * outstanding — spread into every createSignup call below. */
const NEW_SIGNUP_EXTRAS = {
  paid: false,
  subRequestTargetEmail: '',
  subRequestStatus: '' as const,
  subRequestedAt: '',
};

/**
 * A pair (linked via pairId) occupies exactly ONE slot combined (Section
 * 5) — so counting "confirmed slots" means counting distinct pairIds
 * once, not once per row. This is also what makes the "either partner can
 * cancel without freeing the slot" rule work for free: as long as at
 * least one row for a given pairId is still 'confirmed', that pairId is
 * still counted, so the slot stays occupied. Exported since Step 7
 * (promotion) will need the same count.
 */
export function countConfirmedSlots(signups: Signup[]): number {
  const confirmed = signups.filter((s) => s.status === 'confirmed');
  const countedPairIds = new Set<string>();
  let slots = 0;
  for (const s of confirmed) {
    if (s.pairId) {
      if (countedPairIds.has(s.pairId)) continue;
      countedPairIds.add(s.pairId);
    }
    slots += 1;
  }
  return slots;
}

async function computeCapacityStatus(sessionId: string, capacity: number): Promise<'confirmed' | 'waitlisted'> {
  const existing = await listSignupsForSession(sessionId);
  return countConfirmedSlots(existing) < capacity ? 'confirmed' : 'waitlisted';
}

async function requireOpenSessionAndProfile(sessionId: string, email: string) {
  const session = await getSession(sessionId);
  if (!session) throw new ApiError(404, 'No such session.');
  if (session.status !== 'open') {
    throw new ApiError(409, 'Registration is not currently open for this session.');
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

/** A member signing up for themselves. `waiverAccepted` is required
 * (Section 9) — every signup, no exceptions, needs an explicit yes. */
export async function signUpForSession(sessionId: string, email: string, waiverAccepted: boolean): Promise<Signup> {
  requireWaiver(waiverAccepted);
  const { session, player } = await requireOpenSessionAndProfile(sessionId, email);
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

  // Section 5: if a guest already named this member as their inviter and
  // is willing to share, merge now. Neither row's status changes here —
  // linking them via pairId is enough, since countConfirmedSlots treats a
  // shared pairId as one slot regardless of which row(s) are 'confirmed'.
  const pendingGuest = await findPendingGuestInvite(sessionId, player.fullName);
  if (pendingGuest) {
    const pairId = randomUUID();
    await updateSignup(created.signupId, { pairId });
    await updateSignup(pendingGuest.signupId, { pairId });
    return { ...created, pairId };
  }

  return created;
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
  waiverAccepted: boolean
): Promise<Signup> {
  requireWaiver(waiverAccepted);
  if (!invitedByName.trim()) {
    throw new ApiError(400, 'invitedByName is required for a guest signup.');
  }

  const { session, player } = await requireOpenSessionAndProfile(sessionId, email);
  const waiverFields = { waiverAcceptedAt: new Date().toISOString(), waiverText: WAIVER_TEXT };

  if (willingToShare) {
    const memberSignup = await findMemberSignupByName(sessionId, invitedByName);
    // Only pair if the member has signed up AND isn't already paired with
    // someone else — a shared slot is exactly two people, never three.
    if (memberSignup && !memberSignup.pairId) {
      const pairId = randomUUID();
      await updateSignup(memberSignup.signupId, { pairId });
      return createSignup({
        sessionId,
        email,
        fullName: player.fullName,
        gender: player.gender,
        memberStatus: 'guest',
        invitedByName,
        willingToShare: true,
        pairId,
        status: memberSignup.status, // mirrors the member's — they share one slot
        timestamp: new Date().toISOString(),
        positions: player.savedPositions,
        ...waiverFields,
        ...NEW_SIGNUP_EXTRAS,
      });
    }
    // Member hasn't signed up yet (or is already paired with someone
    // else) — fall through to a provisional individual slot below. If the
    // member signs up later in the same window, signUpForSession's merge
    // check will find this row (unpaired, willingToShare, matching name)
    // and pair it then.
  }

  const status = await computeCapacityStatus(sessionId, session.capacity);
  return createSignup({
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
async function promoteNextWaitlisted(allSignupsForSession: Signup[]): Promise<Signup[]> {
  const units = groupWaitlistUnits(allSignupsForSession);
  if (units.length === 0) return [];

  units.sort((a, b) => a.tier - b.tier || a.timestamp.localeCompare(b.timestamp));
  const winner = units[0];
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
 * If a slot was freed and we're not within the 2-hour cutoff (Section 6),
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
  // One read serves both "find this signup" and "current session
  // headcount" — previously a separate getSignup then
  // listSignupsForSession, each a full-tab read.
  const { signup, sessionSignups } = await getSignupWithSessionSignups(signupId);
  if (!signup) throw new ApiError(404, 'No such signup.');
  if (signup.email !== requesterEmail && !requesterIsAdmin) {
    throw new ApiError(403, 'You can only cancel your own signup.');
  }
  if (signup.status === 'cancelled') return { promoted: [] }; // already cancelled, nothing to do

  const session = await getSession(signup.sessionId);
  if (!session) throw new ApiError(404, 'No such session.');

  const before = countConfirmedSlots(sessionSignups);
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
      await sendLateCancellationAlert(signup, session);
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
}

/**
 * Splits session.cost across confirmed slots (pair-aware, same dedup as
 * countConfirmedSlots), then splits each slot's share across however
 * many people share that slot's pairId — 1 for a solo confirmed player,
 * 2 for a pair. Not stored — computed on every read, so it can't drift
 * from reality if headcount or cost changes before payment happens.
 * Rounded to the nearest cent; per-person shares won't always sum to
 * exactly session.cost (e.g. $100 split 13 ways) — accepted, not
 * reconciled, for a casual weekly game.
 */
export function computeCostShare(session: Session, signups: Signup[]): Record<string, number> {
  if (!session.cost) return {};

  const confirmed = signups.filter((s) => s.status === 'confirmed');
  const slots = countConfirmedSlots(signups);
  if (slots === 0) return {};

  const perSlot = session.cost / slots;
  const pairSizes = new Map<string, number>();
  for (const s of confirmed) {
    if (s.pairId) pairSizes.set(s.pairId, (pairSizes.get(s.pairId) ?? 0) + 1);
  }

  const perPerson: Record<string, number> = {};
  for (const s of confirmed) {
    const shareOf = s.pairId ? pairSizes.get(s.pairId) ?? 1 : 1;
    perPerson[s.signupId] = Math.round((perSlot / shareOf) * 100) / 100;
  }
  return perPerson;
}

export interface MyStatus {
  signup: Signup | null;
  /** Other players' pending requests to share a slot with this caller. */
  incomingSubRequests: { fromSignupId: string; fromFullName: string }[];
  /** This caller's own share of session.cost, or null if not priced yet
   * or the caller isn't confirmed. */
  costOwed: number | null;
}

/**
 * Everything the player homepage needs about "me" for this session in
 * one read: reuses a single listSignupsForSession call for both finding
 * the caller's own signup and scanning for incoming sub requests, rather
 * than two separate Sheets reads.
 */
export async function getMyStatusForSession(sessionId: string, email: string): Promise<MyStatus> {
  const normalized = email.trim().toLowerCase();
  const [allSignups, session] = await Promise.all([listSignupsForSession(sessionId), getSession(sessionId)]);

  const signup = allSignups.find((s) => s.email.toLowerCase() === normalized && s.status !== 'cancelled') ?? null;

  const incomingSubRequests = allSignups
    .filter((s) => s.subRequestStatus === 'pending' && s.subRequestTargetEmail.toLowerCase() === normalized)
    .map((s) => ({ fromSignupId: s.signupId, fromFullName: s.fullName }));

  let costOwed: number | null = null;
  if (signup && signup.status === 'confirmed' && session) {
    costOwed = computeCostShare(session, allSignups)[signup.signupId] ?? null;
  }

  return { signup, incomingSubRequests, costOwed };
}
