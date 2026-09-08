import { sendEmail } from './gmail';
import { sendPush } from './ntfy';
import { Signup, Session } from '../sheets/schema';
import { Team, teamNote } from './teams';
import { formatLocation } from './location';
import { getWeeklyMilestones } from './time';

/**
 * The one email type Step 8 covers (Section 7): a promoted player is told
 * they're in. No reminder emails for already-confirmed players.
 */
export async function sendPromotionEmail(signup: Signup, session: Session): Promise<void> {
  const subject = `You're in! Scrimmage on ${session.gameDate}`;
  const text = [
    `Hi ${signup.fullName},`,
    '',
    `A spot opened up and you've moved up from the waitlist. You're now scheduled to play ${whenAndWhere(session)}.`,
    '',
    'See you on the field!',
  ].join('\n');

  await sendEmail(signup.email, subject, text);
}

/**
 * Step 9 (Section 7): a cancellation inside the 5-hour cutoff doesn't get
 * auto-promotion (no time for an email chain), so the organizer gets a
 * push instead — "cancellation details (player name, position, etc.)"
 * about whoever just dropped, so they can personally text someone to
 * fill the spot.
 */
export async function sendLateCancellationAlert(signup: Signup, session: Session, amountOwed = 0): Promise<void> {
  const title = `Late cancellation: ${session.gameDate} scrimmage`;
  const positions = signup.positions || 'no positions listed';
  const parts = [
    `${signup.fullName} (${positions}) just cancelled within 5 hours of the ${session.gameDate} ${session.gameTime} scrimmage.`,
    'No one was auto-promoted, so their spot is open.',
  ];

  // Saves the organizer wondering whether to chase or refund: the money is
  // still owed by the person who cancelled, and if anyone fills in, the two of
  // them settle it between themselves.
  if (amountOwed > 0) {
    parts.push(
      signup.paid
        ? `They've already paid $${signup.amountPaid.toFixed(2)}. No refund; if someone fills in, they settle it directly.`
        : `They still owe $${amountOwed.toFixed(2)}. Collect from them, not from whoever fills in.`
    );
  }

  await sendPush(title, parts.join(' '));
}

/**
 * Registration just closed but the session still has open spots — not in
 * the original guidelines, added so the organizer knows to consider
 * manually adding someone (Section 8's "manually add a signup") rather
 * than discovering unused capacity only once it's too late to fill it.
 */
export async function sendOpenSpotsAlert(session: Session, openSpots: number): Promise<void> {
  const title = `${openSpots} open spot${openSpots === 1 ? '' : 's'} for the ${session.gameDate} scrimmage`;
  const message = `Registration just closed for the ${session.gameDate} ${session.gameTime} scrimmage with ${openSpots} of ${session.capacity} spots still open. Consider manually adding someone.`;

  await sendPush(title, message);
}

/**
 * The roster locked and a first pass at teams is waiting for review.
 *
 * Priority 4: it wants attention within the hour, but it is not the
 * five-minutes-to-fill-a-spot emergency that 5 is reserved for. The click
 * target is the dashboard the message is telling them to open.
 */
export async function sendTeamsReadyAlert(session: Session, teams: Team[]): Promise<void> {
  const players = teams.reduce((n, t) => n + t.members.length, 0);
  const short = teams.filter((t) => t.deficiency > 0).map((t) => `${t.name}: ${teamNote(t)}`);

  const parts = [`${players} players split into ${teams.length} teams for the ${session.gameDate} scrimmage.`];
  parts.push(short.length > 0 ? short.join(' ') : 'Every team can field a full lineup.');
  parts.push('Review and post them from the admin dashboard.');

  const base = process.env.NEXTAUTH_URL;
  await sendPush(`Teams ready for review: ${session.gameDate}`, parts.join(' '), {
    priority: 4,
    tags: ['busts_in_silhouette'],
    click: base ? `${base}/admin` : undefined,
  });
}

/**
 * How many people got in, pushed the moment registration closes.
 *
 * Separate from sendOpenSpotsAlert, which stays silent when the session
 * filled up — which is exactly the case where a second field is worth
 * considering. This one always fires, because it is the signal to decide
 * whether to book one.
 */
export async function sendHeadcountAlert(session: Session, confirmed: number, waitlisted: number): Promise<void> {
  const parts = [`${confirmed} of ${session.capacity} spots filled for the ${session.gameDate} scrimmage.`];
  if (waitlisted > 0) {
    parts.push(`${waitlisted} on the waitlist. Raise capacity to let them in, and book a second field if you need one.`);
  }
  await sendPush(`Registration closed: ${confirmed} playing`, parts.join(' '), { priority: 3, tags: ['clipboard'] });
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

/**
 * A guest named this member as their inviter and is willing to share the
 * member's spot. Distinct from sendSubRequestEmail because the member
 * didn't ask for this and may not recognise the name: the mail has to say
 * where the request came from, not just that one exists.
 */
export async function sendGuestPairRequestEmail(member: Signup, guest: Signup, session: Session): Promise<void> {
  const subject = `${guest.fullName} would like to share your spot`;
  const text = [
    `Hi ${member.fullName},`,
    '',
    `${guest.fullName} signed up as a guest for the ${session.gameDate} scrimmage at ${session.gameTime}, named you as the member who invited them, and is willing to share your spot rather than take a separate one.`,
    '',
    "They're on the waitlist until you decide. Accepting means the two of you share one spot, and split its cost.",
    '',
    "If you don't know this person, decline. Nothing happens to your own spot either way.",
    '',
    'Log into the app to accept or decline.',
  ].join('\n');

  await sendEmail(member.email, subject, text);
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
 *
 * `hasWaitlist` decides whether the closing nudge to cancel appears at all:
 * its entire argument is that someone else is waiting for the spot, which is
 * not true when nobody is. Required rather than defaulted so a new caller has
 * to state which it is, instead of silently dropping the line.
 */
export async function sendGameDayReminderEmail(
  signup: Signup,
  session: Session,
  amountOwed: number,
  hasWaitlist: boolean,
  now: Date = new Date()
): Promise<void> {
  const subject = `Softball this ${session.gameDate} at ${session.gameTime}`;
  const lines = [
    `Hi ${signup.fullName},`,
    '',
    `Reminder: you're confirmed to play ${whenAndWhere(session)}.`,
  ];

  if (session.locationUrl) {
    lines.push('', `Field: ${session.locationUrl}`);
  }

  if (amountOwed > 0 && !signup.paid) {
    // This email goes out on game-day morning, which for an evening game is
    // before payment opens: the roster doesn't lock until 5 hours before the
    // first pitch, and nothing is payable until it does (see PaymentPrompt in
    // app/page.tsx for why the two are deliberately tied together).
    const { cutoffStart } = getWeeklyMilestones(session.gameDate, session.gameTime);
    const opensAt = cutoffStart.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });

    lines.push(
      '',
      now < cutoffStart
        ? `Your spot costs $${amountOwed.toFixed(2)}. Payment opens at ${opensAt}, once the roster locks. Send it any time between then and the game.`
        : `You still owe $${amountOwed.toFixed(2)} for your spot. Please send it before the game.`
    );
    const instructions = process.env.PAYMENT_INSTRUCTIONS;
    if (instructions) lines.push(instructions);
  }

  if (hasWaitlist) {
    lines.push('', "If you can't make it, please cancel so someone on the waitlist can take your spot.");
  }

  await sendEmail(signup.email, subject, lines.join('\n'));
}
