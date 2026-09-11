import { sendEmail } from './gmail';
import { sendPush } from './ntfy';
import { Signup, Session } from '../sheets/schema';
import { Team, teamNote } from './teams';
import { formatLocation } from './location';
import { formatGameDate, formatGameDay, formatGameTime } from './time';
import { paymentOpensAt, paymentStateOf } from './payments';
import { phaseOf, isRosterLocked } from './sessionPhase';

/**
 * Sends a notification without letting it fail the thing that triggered it.
 *
 * A player who cancels has cancelled, whether or not the organizer's push went
 * out; a promoted player is promoted, whether or not the email did. The write
 * has already happened by the time anything is sent, so a mail outage must not
 * turn a completed action into an error the caller sees.
 *
 * That guarantee was previously re-promised by hand at thirteen call sites
 * across seven modules — the same try/catch, written out each time, with
 * nothing testing that it was there. Removing one would have turned a failed
 * email into a failed request for a player, and no test would have noticed.
 * It is one function now, so a new notification gets the guarantee by
 * construction rather than by the author remembering.
 *
 * It is also the single seam to substitute in tests: replace this and every
 * notification in the app is accounted for, rather than reaching past it to
 * whichever transport a given message happens to use.
 *
 * `what` names the attempt, so a swallowed failure is still findable in the
 * logs — silent failure is exactly what the production self-test endpoint
 * exists to catch, and it went unnoticed for a week once already.
 *
 * Returns whether it got through, for the two callers that send to a list and
 * report a sent/failed tally. Swallowing is the guarantee; staying silent
 * about the outcome is not part of it.
 */
export async function deliver(what: string, send: () => Promise<void>): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (err) {
    console.error(`Failed to send ${what}:`, err);
    return false;
  }
}

/**
 * The one email type Step 8 covers (Section 7): a promoted player is told
 * they're in. No reminder emails for already-confirmed players.
 */
export async function sendPromotionEmail(signup: Signup, session: Session): Promise<void> {
  const subject = `Off the waitlist: softball on ${formatGameDate(session.gameDate)}`;
  const text = [
    `Hi ${signup.fullName},`,
    '',
    "A spot opened up, so you're confirmed to play.",
    '',
    // Labelled and on their own lines: this is the email someone reopens on
    // the day to check where to go, and a bare string of date and place reads
    // as an afterthought rather than the thing they came back for.
    `When: ${formatGameDay(session.gameDate, session.gameTime)}`,
    `Where: ${formatLocation({ area: session.locationArea, name: session.locationName, url: session.locationUrl }) || 'still to be confirmed'}`,
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
  const title = `Late cancellation: ${formatGameDate(session.gameDate)}`;
  const positions = signup.positions || 'no positions listed';
  const parts = [
    `${signup.fullName} (${positions}) cancelled within 5 hours of ${formatGameDay(session.gameDate, session.gameTime)}.`,
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
  const title = `${openSpots} open spot${openSpots === 1 ? '' : 's'} for ${formatGameDate(session.gameDate)}`;
  // Number first: this is read at a glance on a lock screen. "Consider
  // manually adding someone" told the organizer to think about it, when the
  // point of sending it is that they should act.
  const message = `${openSpots} of ${session.capacity} spots unfilled for ${formatGameDay(session.gameDate, session.gameTime)}. Registration has closed. Add people by hand if you want them.`;

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

  const parts = [`${players} players split into ${teams.length} teams for ${formatGameDate(session.gameDate)}.`];
  parts.push(short.length > 0 ? short.join(' ') : 'Every team can field a full lineup.');
  parts.push('Review and post them from the admin dashboard.');

  const base = process.env.NEXTAUTH_URL;
  await sendPush(`Teams ready for review: ${formatGameDate(session.gameDate)}`, parts.join(' '), {
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
  const parts = [`${confirmed} of ${session.capacity} spots filled for ${formatGameDate(session.gameDate)}.`];
  if (waitlisted > 0) {
    parts.push(`${waitlisted} on the waitlist. Raise capacity to let them in, and book a second field if you need one.`);
  }
  await sendPush(`Registration closed: ${confirmed} playing`, parts.join(' '), { priority: 3, tags: ['clipboard'] });
}

/** A waitlisted player has asked a specific signed-up player to share
 * their spot — notifies the target so they can log in and respond. */
export async function sendSubRequestEmail(target: Signup, requester: Signup, session: Session): Promise<void> {
  const subject = `${requester.fullName} asked to share your spot on ${formatGameDate(session.gameDate)}`;
  const text = [
    `Hi ${target.fullName},`,
    '',
    // "Willing to sub with them" never said what accepting does. It sets a
    // shared pairId (subRequestFlow) — they share the spot and take turns,
    // which is what CONTEXT.md means by a sub request and what the game-day
    // notes tell them on the day.
    `${requester.fullName} is on the waitlist and has asked to share your spot for ${formatGameDay(session.gameDate, session.gameTime)}. If you accept, the two of you take turns playing.`,
    '',
    'Open the app to accept or decline.',
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
  const subject = `${guest.fullName} asked to share your spot on ${formatGameDate(session.gameDate)}`;
  const text = [
    `Hi ${member.fullName},`,
    '',
    `${guest.fullName} signed up as a guest for ${formatGameDay(session.gameDate, session.gameTime)} and named you as the member who invited them. They've asked to share your spot instead of taking a separate one, which means you take turns playing and split the cost.`,
    '',
    // Kept, not trimmed: this is the sentence standing between a member and a
    // stranger farming invitations, and it only works if declining is
    // explicitly safe.
    "They stay on the waitlist until you answer. If you don't know this person, decline. That changes nothing about your own spot.",
    '',
    'Open the app to accept or decline.',
  ].join('\n');

  await sendEmail(member.email, subject, text);
}

/** Sent to both parties once a sub request is accepted and they're
 * sharing a spot. */
export async function sendSubRequestAcceptedEmail(a: Signup, b: Signup, session: Session): Promise<void> {
  const subject = `You're sharing a spot on ${formatGameDate(session.gameDate)}`;
  const build = (self: Signup, other: Signup) =>
    [
      `Hi ${self.fullName},`,
      '',
      `You and ${other.fullName} are now sharing a spot for ${formatGameDay(session.gameDate, session.gameTime)}.`,
      '',
      // The one email whose reader may not know what sharing means on the day.
      'You take turns, so only one of you is on the field at a time.',
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
  const base = formatGameDay(session.gameDate, session.gameTime);
  return location ? `${base}, ${location}` : base;
}

/**
 * What an unpaid player is told they owe, in the one wording every email
 * that mentions money uses.
 *
 * The before/after split is the whole reason this is shared. Payment opens
 * at the roster lock, five hours before the game, and nothing is payable
 * until it does (see PaymentPrompt in app/page.tsx for why the two are
 * deliberately tied together). The game-day reminder goes out at 9am, which
 * for an evening game is *before* that moment, while a nudge sent by hand
 * could land on either side of it. Two copies of this sentence would
 * eventually disagree about when someone is actually expected to pay.
 *
 * Returns a leading '' so callers can spread it straight into a line list as
 * its own paragraph, and [] when there is nothing owed to talk about.
 */
function paymentLines(session: Session, amountOwed: number, now: Date): string[] {
  if (amountOwed <= 0) return [];

  const opensAt = paymentOpensAt(session).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });

  const state = paymentStateOf({ amountOwed, paid: false, rosterLocked: isRosterLocked(phaseOf(session, now)) });

  const lines = [
    '',
    state === 'not-yet-open'
      ? `Your spot costs $${amountOwed.toFixed(2)}. Payment opens at ${opensAt}. Send it any time between then and the game.`
      // Not "you still owe": that implies an earlier ask, and this is often
      // the first one. A morning game locks its roster before the 9am reminder
      // cron fires, so that email takes this branch — and anyone promoted off
      // the waitlist after it went out never saw the other one either.
      : `Your spot costs $${amountOwed.toFixed(2)}. Please send it before the game.`,
  ];

  const instructions = process.env.PAYMENT_INSTRUCTIONS;
  if (instructions) lines.push(instructions);
  return lines;
}

/**
 * Game-day reminder for a confirmed player: when, where, and what they still
 * owe. Sent in bulk — see sendGameDayReminders in scheduling.ts for why that
 * matters, and fanOut in announcements.ts for the same pacing applied to the
 * organizer's manual sends.
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
  // Sent on game-day morning by a cron that no-ops unless gameDate is today,
  // so "today" is a fact rather than a guess. Nobody needs the year of a game
  // they are playing in nine hours.
  const subject = `Softball today at ${formatGameTime(session.gameTime)}`;
  const lines = [
    `Hi ${signup.fullName},`,
    '',
    `You're confirmed to play today at ${formatGameTime(session.gameTime)}.`,
  ];

  // Named, not just linked. This is the email someone opens in the car, and a
  // bare URL is no use to a passenger reading it aloud.
  const location = formatLocation({
    area: session.locationArea,
    name: session.locationName,
    url: session.locationUrl,
  });
  if (location) lines.push('', `Where: ${location}`);
  if (session.locationUrl) lines.push(`Map: ${session.locationUrl}`);

  if (!signup.paid) {
    lines.push(...paymentLines(session, amountOwed, now));
  }

  if (hasWaitlist) {
    lines.push('', "If you can't make it, please cancel so someone on the waitlist can take your spot.");
  }

  await sendEmail(signup.email, subject, lines.join('\n'));
}

/**
 * The two emails behind the admin dashboard's "Notify players" button.
 *
 * Deliberately sent by hand rather than fired from the PATCH route on every
 * field change. Booking a permit takes several saves — area, then field, then
 * map link, then the price — and a player does not need four emails to learn
 * one thing. The organizer decides when the details have settled enough to be
 * worth telling people, which also means they can add a sentence of their own
 * explaining why.
 *
 * They do NOT try to describe what changed. That would mean storing the last
 * state anyone was told about and diffing against it, and a diff is the wrong
 * shape anyway: what a player needs on Thursday is the current details in full,
 * not a list of edits since Monday.
 */
export async function sendSessionUpdateEmail(signup: Signup, session: Session, note: string): Promise<void> {
  const subject = `Updated details: softball on ${formatGameDate(session.gameDate)}`;
  const location = formatLocation({
    area: session.locationArea,
    name: session.locationName,
    url: session.locationUrl,
  });

  const lines = [
    `Hi ${signup.fullName},`,
    '',
  ];

  // The organizer's note first: it is why this email arrived, and burying it
  // under a block of details the reader may already know makes them hunt for
  // the one thing that changed.
  if (note) lines.push(note, '');

  lines.push(
    "Here's where the game stands:",
    '',
    `When: ${formatGameDay(session.gameDate, session.gameTime)}`,
    `Where: ${location || 'still to be confirmed'}`
  );
  if (session.locationUrl) lines.push(`Map: ${session.locationUrl}`);

  lines.push(
    '',
    "You're confirmed to play. If you can't make it, please cancel in the app so someone else can take your spot."
  );

  await sendEmail(signup.email, subject, lines.join('\n'));
}

/**
 * Goes to waitlisted players as well as confirmed ones, unlike the update
 * above: someone waiting for a spot needs to know there is no longer a spot
 * to wait for, and unlike a change of field, it is not something a later
 * promotion email would tell them anyway.
 */
export async function sendSessionCancelledEmail(signup: Signup, session: Session, note: string): Promise<void> {
  const subject = `Cancelled: softball on ${formatGameDate(session.gameDate)}`;
  const lines = [
    `Hi ${signup.fullName},`,
    '',
    // No time: a cancelled game does not have one.
    `The game on ${formatGameDate(session.gameDate)} has been cancelled. Don't head to the field.`,
  ];

  // Labelled, because an unlabelled sentence between two paragraphs reads as
  // a stray thought rather than the organizer explaining themselves. Omitted
  // entirely when they wrote nothing — "Reason:" with nothing after it is
  // worse than no line at all.
  if (note) lines.push('', `Reason: ${note}`);

  // Cancelling a session deliberately leaves its signups alone (see the PATCH
  // route), so this is a description of what actually happens to their row,
  // not a reassurance invented for the email.
  lines.push('', "Your signup is kept on record in case the game is rescheduled. There's nothing you need to do.");

  await sendEmail(signup.email, subject, lines.join('\n'));
}

/**
 * The admin dashboard's "Remind unpaid" button: one player, one nudge about
 * one week's spot.
 *
 * Says nothing about any other week on purpose. There is no cross-week ledger
 * — `paid` is per signup — so the app genuinely does not know whether someone
 * settled up in August, and an email implying a running balance would be
 * making a claim the data cannot support (see the Signup.paid comment in
 * sheets/schema.ts).
 */
export async function sendPaymentNudgeEmail(
  signup: Signup,
  session: Session,
  amountOwed: number,
  now: Date = new Date()
): Promise<void> {
  const subject = `Payment for the ${formatGameDate(session.gameDate)} game`;
  const lines = [
    `Hi ${signup.fullName},`,
    '',
    `You're confirmed to play ${whenAndWhere(session)}.`,
    ...paymentLines(session, amountOwed, now),
  ];

  await sendEmail(signup.email, subject, lines.join('\n'));
}
