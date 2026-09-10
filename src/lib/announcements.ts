import { getSession } from '../sheets/sessions';
import { listSignupsForSession } from '../sheets/signups';
import { sessionChangeAudience, unpaidAudience } from './audiences';
import { SEND_GAP_MS } from './scheduling';
import { Signup } from '../sheets/schema';
import { deliver } from './notifications';
import { recipientLabel } from './views';
import {
  sendSessionUpdateEmail,
  sendSessionCancelledEmail,
  sendPaymentNudgeEmail,
} from './notifications';

/**
 * The admin dashboard's two "tell the players something" buttons.
 *
 * Both exist because the alternative is worse in the same way. Emailing on
 * every session edit means four emails while a permit gets booked; emailing
 * nobody means a rained-out game strands whoever didn't check the site. An
 * organizer pressing a button is the only party that actually knows which
 * moment is worth twenty people's attention.
 *
 * So neither of these is ever called from a mutation path. They read state
 * that is already settled and send from it — which is also why they are safe
 * to press twice, beyond costing people a duplicate email.
 */

export interface AnnouncementResult {
  sessionId: string;
  /** True when nothing was sent and nothing was wrong — an empty audience. */
  skipped: boolean;
  reason?: string;
  sent: number;
  failed: number;
  /** Who was actually written to, so the dashboard can say more than a count. */
  recipients: string[];
}

const nothingSent = (sessionId: string, reason: string): AnnouncementResult => ({
  sessionId,
  skipped: true,
  reason,
  sent: 0,
  failed: 0,
  recipients: [],
});

/**
 * Sends one email per recipient, sequentially, swallowing individual failures.
 *
 * The pacing is Gmail's burst limit (see SEND_GAP_MS) and the swallowing is so
 * one bad address cannot silently truncate the list — the caller gets a
 * `failed` count and the log gets the address, rather than the send stopping
 * at person three with nobody aware of it.
 */
async function fanOut(
  signups: Signup[],
  send: (signup: Signup) => Promise<void>
): Promise<{ sent: number; failed: number; recipients: string[] }> {
  let sent = 0;
  let failed = 0;
  const recipients: string[] = [];

  for (const [index, signup] of signups.entries()) {
    if (await deliver(`announcement to ${signup.email}`, () => send(signup))) {
      sent += 1;
      recipients.push(recipientLabel(signup));
    } else {
      failed += 1;
    }
    // No trailing wait: the gap is there to space out sends, and there is
    // nothing after the last one to space it from.
    if (index < signups.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }
  }

  return { sent, failed, recipients };
}

/**
 * "Notify players" — broadcasts the session's current details, or the fact
 * that it's off.
 *
 * `note` is an optional sentence from the organizer, included verbatim. It's
 * the difference between "the field changed" and "the field changed because
 * the city double-booked diamond 3", and it is the reason this is a button
 * with a text box rather than an automatic trigger.
 */
export async function notifySessionChange(sessionId: string, note: string): Promise<AnnouncementResult> {
  const session = await getSession(sessionId);
  if (!session) return nothingSent(sessionId, `No session "${sessionId}" exists.`);

  const signups = await listSignupsForSession(sessionId);
  const audience = sessionChangeAudience(session, signups);
  if (audience.length === 0) {
    return nothingSent(sessionId, 'Nobody is signed up for this session yet.');
  }

  const cancelled = session.status === 'cancelled';
  const result = await fanOut(audience, (signup) =>
    cancelled
      ? sendSessionCancelledEmail(signup, session, note)
      : sendSessionUpdateEmail(signup, session, note)
  );

  return { sessionId, skipped: false, ...result };
}

/**
 * "Remind unpaid" — one nudge each to the confirmed players who still owe.
 *
 * Allowed before payment technically opens at the roster lock, because the
 * email adapts (paymentLines in notifications.ts says "payment opens at 1pm"
 * rather than "you still owe"). An organizer who wants to give people a day's
 * warning is not doing anything wrong, so the button doesn't second-guess the
 * timing — it just refuses to send a sentence that isn't true yet.
 */
export async function nudgeUnpaidPlayers(sessionId: string, now: Date = new Date()): Promise<AnnouncementResult> {
  const session = await getSession(sessionId);
  if (!session) return nothingSent(sessionId, `No session "${sessionId}" exists.`);
  if (session.pricePerSpot <= 0) {
    return nothingSent(sessionId, 'No price per spot is set for this session, so nobody owes anything.');
  }

  const signups = await listSignupsForSession(sessionId);
  const unpaid = unpaidAudience(session, signups);
  if (unpaid.length === 0) {
    return nothingSent(sessionId, 'Nobody on the confirmed roster still owes anything.');
  }

  const owedBySignupId = new Map(unpaid.map(({ signup, owed }) => [signup.signupId, owed]));
  const result = await fanOut(
    unpaid.map(({ signup }) => signup),
    (signup) => sendPaymentNudgeEmail(signup, session, owedBySignupId.get(signup.signupId) ?? 0, now)
  );

  return { sessionId, skipped: false, ...result };
}
