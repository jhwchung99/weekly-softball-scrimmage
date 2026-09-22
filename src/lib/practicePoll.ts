import { Session, Signup, PracticePollAnswer } from '../sheets/schema';
import { countConfirmedSpots } from './payments';
import { hasGameStarted, phaseOf, type Scheduled } from './sessionPhase';
import { formatGameDate, formatGameDay } from './time';
import { formatLocation } from './location';

/**
 * Everything about the practice poll that can be decided without reading
 * Sheets.
 *
 * Pure, and free of server-only imports, for the reason audiences.ts and
 * payments.ts are: the dashboard labels its button with a count and shows or
 * hides the whole control based on the threshold, and a second hand-rolled
 * copy of those rules in the browser is a copy that eventually disagrees with
 * what the server actually allows.
 *
 * Parameters are structural subsets rather than full rows, so the browser's
 * lighter DTOs satisfy them without a cast.
 */

/**
 * The confirmed-spots count below which a week is light enough to ask about.
 *
 * Sixteen *spots*, not sixteen people. A shared spot is two players taking
 * turns, so it puts one body on the field at a time (ADR-0004, and the
 * guidelines tell players exactly this). Fifteen spots with three shared is
 * eighteen people signed up and still not enough for a game, which is the
 * week this poll exists for.
 */
export const DEFAULT_PRACTICE_POLL_THRESHOLD = 16;

type Pollable = Pick<Session, 'practicePollStatus' | 'practicePollThreshold'> & Scheduled;
type Answerable = Pick<Signup, 'signupId' | 'status' | 'pairId' | 'practicePollAnswer' | 'fullName'>;

/**
 * This session's threshold, or the default when it has not set one.
 *
 * A session field rather than a constant, following rosterLockAt and
 * ADR-0006: sixteen is right most weeks, and the weeks it is wrong — a second
 * diamond booked, a tournament weekend — are ones the organizer can see
 * coming. 0 means unset, the way rosterLockAt uses ''.
 */
export function thresholdFor(session: Pick<Session, 'practicePollThreshold'>): number {
  return session.practicePollThreshold > 0 ? session.practicePollThreshold : DEFAULT_PRACTICE_POLL_THRESHOLD;
}

/** Confirmed spots, which is the number the threshold is measured against. */
export function confirmedSpots(signups: Pick<Signup, 'signupId' | 'status' | 'pairId'>[]): number {
  return countConfirmedSpots(signups);
}

/**
 * Whether the organizer may open a poll right now.
 *
 * Checked in the browser to decide whether the control exists at all, and
 * again on the server before the write, because the button is not the rule.
 */
export function canOpenPracticePoll(session: Pollable, signups: Answerable[], now: Date = new Date()): boolean {
  if (session.practicePollStatus === 'open') return false;
  if (hasGameStarted(phaseOf(session, now))) return false;
  return confirmedSpots(signups) < thresholdFor(session);
}

/**
 * Whether a confirmed player may still answer.
 *
 * Answers stay changeable while the poll is open, because someone who says no
 * on Tuesday and frees up on Thursday should not have to email the organizer.
 * Once it closes the panel stays visible but goes read-only.
 */
export function canAnswerPracticePoll(
  session: Pick<Session, 'practicePollStatus'> & Scheduled,
  signup: Pick<Signup, 'status'>,
  now: Date = new Date()
): boolean {
  if (session.practicePollStatus !== 'open') return false;
  if (hasGameStarted(phaseOf(session, now))) return false;
  return signup.status === 'confirmed';
}

export interface PracticePollTally {
  yes: number;
  no: number;
  /** Confirmed players who have not answered. Counted separately from `no`:
   * silence is not a refusal, and an organizer reading "4 no" when three of
   * them simply have not opened the app would decide the wrong thing. */
  unanswered: number;
  yesNames: string[];
  noNames: string[];
  unansweredNames: string[];
}

/**
 * The dashboard's summary. Confirmed players only, because they are the only
 * ones who can answer.
 *
 * Counts people rather than spots, unlike the threshold. The threshold asks
 * "can we field a game"; this asks "who said they would come", and both
 * halves of a shared spot answer for themselves.
 */
export function tallyPracticePoll(signups: Answerable[]): PracticePollTally {
  const confirmed = signups.filter((s) => s.status === 'confirmed');
  const bucket = (answer: PracticePollAnswer) => confirmed.filter((s) => s.practicePollAnswer === answer);

  const yes = bucket('yes');
  const no = bucket('no');
  const unanswered = bucket('');

  return {
    yes: yes.length,
    no: no.length,
    unanswered: unanswered.length,
    yesNames: yes.map((s) => s.fullName),
    noNames: no.map((s) => s.fullName),
    unansweredNames: unanswered.map((s) => s.fullName),
  };
}

/**
 * A poll is open but enough people have signed up after all.
 *
 * Does not close anything. The organizer asked for the poll to stay open when
 * turnout recovers, because people answering "yes, I'd do practice" does not
 * stop them playing a game, and the extra signups may yet cancel. This only
 * drives a line on the dashboard saying it happened.
 */
export function turnoutRecovered(session: Pollable, signups: Answerable[]): boolean {
  return session.practicePollStatus === 'open' && confirmedSpots(signups) >= thresholdFor(session);
}

// ---------------------------------------------------------------------------
// The draft the dashboard offers after marking a week as BP/Practice
//
// Marking the format emails nobody, on purpose. This is the compromise: the
// organizer gets a message written for them, in the message box, and decides
// whether to send it. Player-facing copy, so docs/voice.md applies and this
// module is on copyVoice's COPY_FILES list.
// ---------------------------------------------------------------------------

type Announceable = Pick<Session, 'gameDate' | 'gameTime' | 'locationArea' | 'locationName' | 'locationUrl'>;

export function practiceMessageSubject(session: Announceable): string {
  return `BP/Practice on ${formatGameDate(session.gameDate)}`;
}

/**
 * No greeting: sendPlainMessageEmail adds "Hi <name>," itself, and a second
 * one in the body would read as a stutter.
 *
 * The location line is dropped entirely until the field is booked rather than
 * saying "TBD", which is a line that tells the reader nothing they did not
 * already know.
 */
export function practiceMessageBody(session: Announceable): string {
  const location = formatLocation({
    area: session.locationArea,
    name: session.locationName,
    url: session.locationUrl,
  });

  const lines = [
    // The fact first, per rule 6. Why it is BP/Practice matters more than
    // when, because the when has not changed.
    'Not enough people signed up for a game this week, so we are running BP/Practice instead.',
    '',
    location
      ? `${formatGameDay(session.gameDate, session.gameTime)}, at ${location}.`
      : `${formatGameDay(session.gameDate, session.gameTime)}.`,
    '',
    'If you can no longer make it, please cancel in the app.',
  ];

  return lines.join('\n');
}
