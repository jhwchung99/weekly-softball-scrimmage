import {
  sendPromotionEmail,
  sendSubRequestEmail,
  sendGuestPairRequestEmail,
  sendSubRequestAcceptedEmail,
  sendGameDayReminderEmail,
  sendSessionUpdateEmail,
  sendSessionCancelledEmail,
  sendPaymentNudgeEmail,
} from '../src/lib/notifications';
import type { Session, Signup } from '../src/sheets/schema';

/**
 * Sends one of every player email to **yourself**, so the wording can be read
 * in a real mail client on a real phone rather than in a diff.
 *
 * Two things make it safe to run against production credentials:
 *
 *   1. **It imports nothing from `../src/sheets`.** There is no code path here
 *      that can read the Signups tab, so no real player's address is ever in
 *      memory. Every recipient comes from the fixtures below.
 *   2. **Every fixture is addressed to the confirmed target**, asserted before
 *      anything sends. The notification functions take the address off the
 *      signup they are given, so fixing the fixtures fixes the recipients.
 *
 * Dry run by default. Sending needs the target spelled out:
 *
 *     npm run preview:emails -- --send --to=you@example.com
 *
 * and it must match GMAIL_SENDER_EMAIL — the same address the self-test uses,
 * and the only one this app is ever allowed to mail on purpose.
 */

const SESSION: Session = {
  sessionId: '2026-07-10',
  gameDate: '2026-07-10',
  gameTime: '18:00',
  registrationOpensAt: '',
  registrationClosesAt: '',
  capacity: 20,
  status: 'open',
  cost: 120,
  pricePerSpot: 12.5,
  locationArea: 'Mississauga',
  locationName: 'Iceland Diamond 3',
  locationUrl: 'https://maps.app.goo.gl/example',
  numFields: 1,
  rosterLockAt: '',
  teamsStatus: '',
  remindersSentAt: '',
};

function signup(email: string, fullName: string, over: Partial<Signup> = {}): Signup {
  return {
    signupId: `preview-${fullName.toLowerCase().replace(/\W+/g, '-')}`,
    sessionId: SESSION.sessionId,
    email,
    fullName,
    gender: 'Other',
    memberStatus: 'member',
    invitedByName: '',
    willingToShare: false,
    pairId: '',
    status: 'confirmed',
    timestamp: '2026-07-06T13:00:00.000Z',
    positions: 'SS, 2B',
    waiverAcceptedAt: '2026-07-06T13:00:00.000Z',
    waiverText: '',
    paid: false,
    amountPaid: 0,
    paidAt: '',
    attended: false,
    subRequestTargetEmail: '',
    subRequestStatus: '',
    subRequestedAt: '',
    teamName: '',
  };
}

/**
 * Every email, named as it will arrive.
 *
 * `you` is the recipient for all of them. The second party in the two-sided
 * emails is a made-up name with the *same* address, so those arrive twice and
 * both halves can be read — which matters, because the sub-accepted email
 * builds a different body for each person.
 */
function everyEmail(you: string) {
  const me = signup(you, 'Kevin Kim');
  const other = signup(you, 'Dana Reyes');
  const guest = signup(you, 'Sam Okafor', { memberStatus: 'guest', willingToShare: true, status: 'waitlisted' });

  // Checked rather than trusted. Every notification function takes the address
  // off the signup it is handed, so this list is the complete set of people
  // this script can possibly mail.
  const recipients = [me, other, guest].map((s) => s.email);
  const strangers = recipients.filter((email) => email !== you);
  if (strangers.length > 0) {
    throw new Error(`Refusing to send: fixtures addressed to ${strangers.join(', ')} rather than ${you}.`);
  }

  return [
    ['promotion off the waitlist', () => sendPromotionEmail(me, SESSION)],
    ['sub request received', () => sendSubRequestEmail(me, other, SESSION)],
    ['guest asking to share your spot', () => sendGuestPairRequestEmail(me, guest, SESSION)],
    ['sub request accepted (sends both halves)', () => sendSubRequestAcceptedEmail(me, other, SESSION)],
    // Two branches of ONE email, not two emails. A player gets a single
    // reminder with whichever paragraphs apply to them. Both are sent here
    // because the paragraphs are the part worth reading, but they share a
    // subject line, so in an inbox they look like a double-send. They are not.
    ['game-day reminder [1 of 2 branches] unpaid, waitlist waiting', () => sendGameDayReminderEmail(me, SESSION, 12.5, true, new Date())],
    ['game-day reminder [2 of 2 branches] paid, nobody waiting', () => sendGameDayReminderEmail({ ...me, paid: true }, SESSION, 0, false, new Date())],
    ['session details updated', () => sendSessionUpdateEmail(me, SESSION, 'The city moved us to diamond 5.')],
    ['session cancelled', () => sendSessionCancelledEmail(me, { ...SESSION, status: 'cancelled' }, 'Rained out.')],
    ['payment nudge', () => sendPaymentNudgeEmail(me, SESSION, 12.5, new Date())],
  ] as const;
}

function targetFromArgs(): string | null {
  const flag = process.argv.find((a) => a.startsWith('--to='));
  return flag ? flag.slice('--to='.length) : null;
}

async function main() {
  const send = process.argv.includes('--send');
  const sender = process.env.GMAIL_SENDER_EMAIL;
  const emails = everyEmail(sender ?? 'you@example.test');

  if (!send) {
    console.log(`DRY RUN — nothing will be sent.\n`);
    console.log(`${emails.length} emails would go to: ${sender ?? '(GMAIL_SENDER_EMAIL is not set)'}\n`);
    for (const [name] of emails) console.log(`  - ${name}`);
    console.log(
      `\nNote: the two game-day reminder branches share a subject line, so they` +
        `\narrive looking like a double-send. A real player gets one of them.`
    );
    console.log(`\nTo send them: npm run preview:emails -- --send --to=${sender ?? '<your address>'}`);
    return;
  }

  if (!sender) throw new Error('GMAIL_SENDER_EMAIL is not set, so there is nowhere safe to send these.');

  const target = targetFromArgs();
  if (target !== sender) {
    throw new Error(
      target === null
        ? `Refusing to send. Pass --to=${sender} to confirm where these go.`
        : `Refusing to send. You named ${target}, but this app can only send from and to ${sender}.`
    );
  }

  console.log(`Sending ${emails.length} emails to ${sender}.\n`);
  for (const [name, send] of emails) {
    // Deliberately not wrapped in `deliver`: a failure here is the point of
    // running this, and swallowing it would report success on an empty inbox.
    await send();
    console.log(`  sent: ${name}`);
    // Gmail's burst limit, same pacing the real fan-outs use.
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('\nDone. Read them on a phone.');
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
