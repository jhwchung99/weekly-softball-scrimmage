import { randomUUID } from 'node:crypto';
import { getSession } from '../sheets/sessions';
import { getSignup, getSignupWithSessionSignups, updateSignup, batchUpdateSignups } from '../sheets/signups';
import { Signup } from '../sheets/schema';
import { ApiError } from './apiErrors';
import { sendSubRequestEmail, sendSubRequestAcceptedEmail } from './notifications';
import { normalizeEmail } from './email';

const NO_REQUEST = { subRequestTargetEmail: '', subRequestStatus: '' as const, subRequestedAt: '' };

/**
 * A waitlisted player proposing to share a specific active player's slot
 * (Section-adjacent feature — see
 * planner/2026-09-04-sub-requests-roster-cost-plan.md). Reuses the
 * existing pairId slot-sharing mechanic: accepting this never changes
 * capacity, since a pair always counts as one slot
 * (countConfirmedSlots) — so there's no promotion cascade to run here,
 * unlike a normal signup.
 */
export async function requestSub(signupId: string, requesterEmail: string, targetEmail: string): Promise<Signup> {
  // One tab read serving both "find my own signup" and "find the
  // target within this session" — previously two separate full-tab
  // reads (getSignup, then listSignupsForSession).
  const { signup, sessionSignups } = await getSignupWithSessionSignups(signupId);
  if (!signup) throw new ApiError(404, 'No such signup.');
  if (normalizeEmail(signup.email) !== normalizeEmail(requesterEmail)) {
    throw new ApiError(403, 'You can only request a sub for your own signup.');
  }
  if (signup.status !== 'waitlisted') throw new ApiError(409, 'Only a waitlisted signup can request to sub in.');
  if (signup.pairId) throw new ApiError(409, "You're already sharing a slot with someone else.");
  // Anti-spam: only one outstanding outgoing request at a time. A prior
  // request already sitting at 'declined' doesn't block a new one — only
  // 'pending' does. cancelSubRequest is the deliberate way out if the
  // target never responds.
  if (signup.subRequestStatus === 'pending') {
    throw new ApiError(409, 'You already have a pending sub request — cancel it before requesting someone else.');
  }

  const normalizedTarget = normalizeEmail(targetEmail);
  if (normalizedTarget === normalizeEmail(requesterEmail)) {
    throw new ApiError(400, "You can't request to sub with yourself.");
  }

  const target = sessionSignups.find((s) => normalizeEmail(s.email) === normalizedTarget && s.status !== 'cancelled');
  if (!target) throw new ApiError(400, "That email isn't signed up for this session.");
  if (target.pairId) throw new ApiError(400, 'That person is already sharing a slot with someone else.');

  const session = await getSession(signup.sessionId);
  if (!session) throw new ApiError(404, 'No such session.');

  const updated = await updateSignup(signupId, {
    subRequestTargetEmail: target.email,
    subRequestStatus: 'pending',
    subRequestedAt: new Date().toISOString(),
  });

  // The request itself already succeeded — a failed notification
  // shouldn't undo it or surface as an error to the requester (same
  // awaited-but-swallowed pattern used for promotion/alert emails in
  // signupFlow.ts).
  try {
    await sendSubRequestEmail(target, updated, session);
  } catch (err) {
    console.error(`Failed to send sub-request email for signup ${signupId}:`, err);
  }

  return updated;
}

/**
 * The requester's way out of a pending request that isn't getting a
 * response — without this, the anti-spam "one outstanding request at a
 * time" rule in requestSub would leave them stuck.
 */
export async function cancelSubRequest(signupId: string, requesterEmail: string): Promise<Signup> {
  const signup = await getSignup(signupId);
  if (!signup) throw new ApiError(404, 'No such signup.');
  if (normalizeEmail(signup.email) !== normalizeEmail(requesterEmail)) {
    throw new ApiError(403, 'You can only cancel your own sub request.');
  }
  if (signup.subRequestStatus !== 'pending') throw new ApiError(409, 'No pending sub request to cancel.');

  return updateSignup(signupId, { ...NO_REQUEST });
}

/**
 * `signupId` is the REQUESTER's row (where the pending request lives),
 * not the responder's — the responder is identified by their session
 * email matching subRequestTargetEmail on that row. Keeps every
 * sub-request route keyed by the same signupId convention as the rest of
 * the app, instead of a separate request-id resource.
 */
export async function respondToSubRequest(signupId: string, responderEmail: string, accept: boolean): Promise<Signup> {
  // Same one-read-serves-both pattern as requestSub above.
  const { signup: requester, sessionSignups: allSignups } = await getSignupWithSessionSignups(signupId);
  if (!requester) throw new ApiError(404, 'No such signup.');
  if (requester.subRequestStatus !== 'pending') throw new ApiError(409, 'This request is no longer pending.');

  const normalizedResponder = normalizeEmail(responderEmail);
  if (normalizeEmail(requester.subRequestTargetEmail) !== normalizedResponder) {
    throw new ApiError(403, 'This request is not addressed to you.');
  }

  if (!accept) {
    return updateSignup(signupId, { subRequestStatus: 'declined' });
  }

  const target = allSignups.find((s) => normalizeEmail(s.email) === normalizedResponder && s.status !== 'cancelled');
  if (!target) throw new ApiError(409, 'Your own signup for this session is no longer active.');
  if (requester.status === 'cancelled') throw new ApiError(409, 'That signup is no longer active.');
  // Re-check the same precondition requestSub enforced, because the
  // requester's status can change between asking and answering (an admin
  // status override doesn't clear pending requests). Without this, accepting
  // folds an already-confirmed player into the target's slot, silently
  // dropping the roster below capacity with no promotion cascade to refill
  // it. See planner/2026-09-05-code-security-review.md, Bug 2.
  if (requester.status !== 'waitlisted') {
    throw new ApiError(409, 'That person already has their own spot — nothing to sub into.');
  }
  if (target.pairId) throw new ApiError(409, "You're already sharing a slot with someone else.");
  if (requester.pairId) throw new ApiError(409, 'That signup is already sharing a slot with someone else.');

  const session = await getSession(requester.sessionId);
  if (!session) throw new ApiError(404, 'No such session.');

  const pairId = randomUUID();
  // Accepting one request makes every other pending request targeting
  // the same person moot — decline them explicitly (not silently
  // cleared) so those requesters see what happened rather than their
  // request just vanishing.
  const others = allSignups.filter(
    (s) =>
      s.signupId !== signupId &&
      s.subRequestStatus === 'pending' &&
      normalizeEmail(s.subRequestTargetEmail) === normalizedResponder
  );

  // Every write this acceptance needs — pairing both sides, clearing the
  // requester's own request fields, and declining everyone else's
  // pending request to the same target — happens in one Sheets API call
  // instead of one call per row.
  const results = await batchUpdateSignups([
    { signupId: target.signupId, updates: { pairId } },
    { signupId, updates: { pairId, status: target.status, ...NO_REQUEST } },
    ...others.map((o) => ({ signupId: o.signupId, updates: { subRequestStatus: 'declined' as const } })),
  ]);
  const updatedRequester = results.find((r) => r.signupId === signupId)!;

  try {
    await sendSubRequestAcceptedEmail(updatedRequester, target, session);
  } catch (err) {
    console.error(`Failed to send sub-request acceptance email for signup ${signupId}:`, err);
  }

  return updatedRequester;
}

/** Cleanup used by cancelMySignup/promoteNextWaitlisted (signupFlow.ts):
 * a signup's own outgoing pending request becomes moot once that signup
 * is cancelled or gets its own slot via normal promotion. */
export async function clearOwnPendingRequest(signup: Signup): Promise<void> {
  if (signup.subRequestStatus === 'pending') {
    await updateSignup(signup.signupId, { ...NO_REQUEST });
  }
}

/** Cleanup used by cancelMySignup: if this signup just cancelled, any
 * *other* signup's pending request that was targeting it is now asking a
 * person who's gone — clear those back to no-request (not 'declined',
 * since this isn't a decision the target made). */
export async function clearPendingRequestsTargeting(
  email: string,
  signupsForSession: Signup[],
  excludeSignupId?: string
): Promise<void> {
  const normalized = normalizeEmail(email);
  const targeting = signupsForSession.filter(
    (s) => s.signupId !== excludeSignupId && s.subRequestStatus === 'pending' && normalizeEmail(s.subRequestTargetEmail) === normalized
  );
  if (targeting.length === 0) return;
  await batchUpdateSignups(targeting.map((s) => ({ signupId: s.signupId, updates: { ...NO_REQUEST } })));
}
