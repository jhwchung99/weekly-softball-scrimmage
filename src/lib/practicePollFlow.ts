import { getSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession, updateSignup } from '../sheets/signups';
import { Session, Signup, SessionFormat, PracticePollAnswer, PracticePollStatus } from '../sheets/schema';
import { withMutationLock } from './lock';
import { ApiError } from './apiErrors';
import { normalizeEmail } from './email';
import { canAnswerPracticePoll, canOpenPracticePoll, thresholdFor } from './practicePoll';

/**
 * The three writes behind the practice poll.
 *
 * Each acquires the global mutation lock itself, per ADR-0001 — no route
 * module mentions the lock, so a new caller gets the guarantee by
 * construction rather than by remembering.
 *
 * None of them sends anything. Opening the poll can be accompanied by an
 * email, but that is the route's doing and the organizer's checkbox; closing
 * a poll and marking a week as practice are both silent by design. The
 * organizer said it should be flexible and manual, and an app that mails
 * twenty people the moment a button is pressed is neither.
 */

/**
 * Open or close the poll, optionally stating a deadline.
 *
 * `closesAt` is advisory: it is shown to players as when to answer by, and
 * nothing in the app acts on it when it passes. The organizer closes the poll
 * by hand, which is the point — a week can stay open past its own deadline
 * while they wait on two more replies.
 */
export async function setPracticePollStatus(
  sessionId: string,
  status: Exclude<PracticePollStatus, ''>,
  closesAt: string = ''
): Promise<Session> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');
    if (session.status === 'cancelled') {
      throw new ApiError(409, 'This game is cancelled, so there is nothing to ask anyone about.');
    }

    if (status === 'open') {
      // Re-checked here and not only in the dashboard. The dashboard hides
      // the button above the threshold, but the button is not the rule, and
      // a stale tab is enough to press one that should no longer exist.
      const signups = await listSignupsForSession(sessionId);
      if (!canOpenPracticePoll(session, signups)) {
        throw new ApiError(
          409,
          `A practice poll is only for a light week: this one has ${signups.filter((s) => s.status === 'confirmed').length} confirmed and a threshold of ${thresholdFor(session)}.`
        );
      }
    }

    return updateSession(sessionId, { practicePollStatus: status, practicePollClosesAt: closesAt });
  });
}

/** Mark the week as batting practice, or back to a game. */
export async function setSessionFormat(sessionId: string, format: SessionFormat): Promise<Session> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');
    if (session.status === 'cancelled') {
      throw new ApiError(409, 'This game is cancelled, so it is not being played in any format.');
    }
    return updateSession(sessionId, { format });
  });
}

/**
 * Record one player's answer, or change it.
 *
 * Identity comes from the caller's session, never from the request body, so
 * one player cannot answer for another.
 */
export async function answerPracticePoll(
  sessionId: string,
  email: string,
  answer: Exclude<PracticePollAnswer, ''>,
  now: Date = new Date()
): Promise<Signup> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');

    const normalized = normalizeEmail(email);
    const signups = await listSignupsForSession(sessionId);
    const mine = signups.find((s) => normalizeEmail(s.email) === normalized && s.status !== 'cancelled');
    if (!mine) throw new ApiError(404, 'You are not signed up for this week.');

    if (!canAnswerPracticePoll(session, mine, now)) {
      // One message for three causes on purpose. The player does not need to
      // know which: in all three the answer is the same, and the panel they
      // are looking at already says whether it is still open.
      throw new ApiError(409, 'This poll is not taking answers.');
    }

    return updateSignup(mine.signupId, {
      practicePollAnswer: answer,
      practicePollAnsweredAt: now.toISOString(),
    });
  });
}
