import { randomUUID } from 'node:crypto';
import { sendPush } from './ntfy';
import { appendFeedback } from '../sheets/feedback';
import { SPREADSHEET_ID } from '../sheets/client';
import { FeedbackKind } from './feedbackKinds';

/** How each kind announces itself on the organizer's lock screen. */
const KIND_PUSH: Record<FeedbackKind, { title: string; noun: string; tag: string }> = {
  bug: { title: 'Bug report submitted', noun: 'a bug report', tag: 'lady_beetle' },
  feedback: { title: 'Feedback submitted', noun: 'feedback', tag: 'speech_balloon' },
};

/** A notification title is a single line; a name carrying a newline would
 * otherwise split it in the middle. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export interface FeedbackReport {
  kind: FeedbackKind;
  message: string;
  /** The page the reporter was on, so a bug report says where to look. */
  pageUrl: string;
  /** Both come from the verified session, never from the request body:
   * the record names a real person, so it must not be spoofable. */
  fromEmail: string;
  fromName: string;
}

/**
 * Files a player's bug report or suggestion.
 *
 * The Feedback tab is the record; the push is only a nudge to go read it.
 * That split is deliberate: a notification is easy to swipe away and
 * impossible to search later, and the message itself can run to a
 * paragraph that no lock screen shows in full. So the row is written
 * first and its failure fails the request (the reporter needs to know
 * their message wasn't kept), while a failed push is logged and
 * swallowed, matching how signupFlow treats its promotion emails.
 *
 * Sent at normal priority, unlike the late-cancellation alert sharing
 * this ntfy topic: that one is a "you have minutes to fill this spot"
 * emergency, this one can wait until morning.
 */
export async function recordFeedback(report: FeedbackReport, now: Date = new Date()): Promise<void> {
  const { title, noun, tag } = KIND_PUSH[report.kind];
  const who = oneLine(report.fromName) || report.fromEmail;

  await appendFeedback({
    feedbackId: randomUUID(),
    submittedAt: now.toISOString(),
    kind: report.kind,
    email: report.fromEmail,
    fullName: oneLine(report.fromName),
    message: report.message,
    pageUrl: report.pageUrl,
  });

  try {
    await sendPush(title, `${who} just submitted ${noun}. Open the Feedback tab to read it.`, {
      priority: 3,
      tags: [tag],
      // Tapping the alert goes straight to the sheet holding the message.
      click: SPREADSHEET_ID ? `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit` : undefined,
    });
  } catch (err) {
    console.error('Failed to send the feedback push alert:', err);
  }
}
