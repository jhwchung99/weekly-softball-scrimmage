import { sendEmail } from './gmail';
import { sendPush } from './ntfy';
import { Signup, Session } from '../sheets/schema';
import { formatLocation } from './location';

/**
 * The one email type Step 8 covers (Section 7): a promoted player is told
 * they're in. No reminder emails for already-confirmed players.
 */
export async function sendPromotionEmail(signup: Signup, session: Session): Promise<void> {
  const subject = `You're in! Scrimmage on ${session.gameDate}`;
  const text = [
    `Hi ${signup.fullName},`,
    '',
    `A spot opened up and you've moved up from the waitlist — you're now scheduled to play ${whenAndWhere(session)}.`,
    '',
    'See you on the field!',
  ].join('\n');

  await sendEmail(signup.email, subject, text);
}

/**
 * Step 9 (Section 7): a cancellation inside the 2-hour cutoff doesn't get
 * auto-promotion (no time for an email chain), so the organizer gets a
 * push instead — "cancellation details (player name, position, etc.)"
 * about whoever just dropped, so they can personally text someone to
 * fill the spot.
 */
export async function sendLateCancellationAlert(signup: Signup, session: Session): Promise<void> {
  const title = `Late cancellation — ${session.gameDate} scrimmage`;
  const positions = signup.positions || 'no positions listed';
  const message = `${signup.fullName} (${positions}) just cancelled within 2 hours of the ${session.gameDate} ${session.gameTime} scrimmage. No one was auto-promoted — their spot is open.`;

  await sendPush(title, message);
}

/**
 * Registration just closed but the session still has open spots — not in
 * the original guidelines, added so the organizer knows to consider
 * manually adding someone (Section 8's "manually add a signup") rather
 * than discovering unused capacity only once it's too late to fill it.
 */
export async function sendOpenSpotsAlert(session: Session, openSpots: number): Promise<void> {
  const title = `${openSpots} open spot${openSpots === 1 ? '' : 's'} — ${session.gameDate} scrimmage`;
  const message = `Registration just closed for the ${session.gameDate} ${session.gameTime} scrimmage with ${openSpots} of ${session.capacity} spots still open. Consider manually adding someone.`;

  await sendPush(title, message);
}

/** A waitlisted player has asked a specific signed-up player to share
 * their spot — notifies the target so they can log in and respond. */
export async function sendSubRequestEmail(target: Signup, requester: Signup, session: Session): Promise<void> {
  const subject = `Sub request for the ${session.gameDate} scrimmage`;
  const text = [
    `Hi ${target.fullName},`,
    '',
    `${requester.fullName} would like to know if you're willing to sub with them for the ${session.gameDate} scrimmage at ${session.gameTime}.`,
    '',
    'Log into the app to accept or decline.',
  ].join('\n');

  await sendEmail(target.email, subject, text);
}

/** Sent to both parties once a sub request is accepted and they're
 * sharing a spot. */
export async function sendSubRequestAcceptedEmail(a: Signup, b: Signup, session: Session): Promise<void> {
  const subject = `You're set to share a spot for the ${session.gameDate} scrimmage`;
  const build = (self: Signup, other: Signup) =>
    [
      `Hi ${self.fullName},`,
      '',
      `${other.fullName} and you are now sharing a spot for the ${session.gameDate} scrimmage at ${session.gameTime}.`,
      '',
      'See you on the field!',
    ].join('\n');

  await sendEmail(a.email, subject, build(a, b));
  await sendEmail(b.email, subject, build(b, a));
}

/** Where and when, in the one form every email should describe it. */
function whenAndWhere(session: Session): string {
  const location = formatLocation({
    area: session.locationArea,
    name: session.locationName,
    url: session.locationUrl,
  });
  const base = `${session.gameDate} at ${session.gameTime}`;
  return location ? `${base}, ${location}` : base;
}

/**
 * Game-day reminder for a confirmed player: when, where, and what they still
 * owe. The only bulk send in the app — see sendGameDayReminders in
 * scheduling.ts for why that matters.
 */
export async function sendGameDayReminderEmail(signup: Signup, session: Session, amountOwed: number): Promise<void> {
  const subject = `Softball this ${session.gameDate} — ${session.gameTime}`;
  const lines = [
    `Hi ${signup.fullName},`,
    '',
    `Reminder: you're confirmed to play ${whenAndWhere(session)}.`,
  ];

  if (session.locationUrl) {
    lines.push('', `Field: ${session.locationUrl}`);
  }

  if (amountOwed > 0 && !signup.paid) {
    lines.push('', `You still owe $${amountOwed.toFixed(2)} for your spot — please send it before the game.`);
    const instructions = process.env.PAYMENT_INSTRUCTIONS;
    if (instructions) lines.push(instructions);
  }

  lines.push('', "Can't make it? Cancel in the app so someone on the waitlist can take your spot.");

  await sendEmail(signup.email, subject, lines.join('\n'));
}
