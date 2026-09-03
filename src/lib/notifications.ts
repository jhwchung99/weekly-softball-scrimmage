import { sendEmail } from './gmail';
import { sendPush } from './ntfy';
import { Signup, Session } from '../sheets/schema';

/**
 * The one email type Step 8 covers (Section 7): a promoted player is told
 * they're in. No reminder emails for already-confirmed players.
 */
export async function sendPromotionEmail(signup: Signup, session: Session): Promise<void> {
  const subject = `You're in! Scrimmage on ${session.gameDate}`;
  const text = [
    `Hi ${signup.fullName},`,
    '',
    `A spot opened up and you've moved up from the waitlist — you're now scheduled to play in the ${session.gameDate} scrimmage at ${session.gameTime}.`,
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
