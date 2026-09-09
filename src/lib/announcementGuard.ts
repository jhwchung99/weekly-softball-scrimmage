import { checkRateLimit } from './rateLimit';
import { ApiError } from './apiErrors';

/**
 * A one-minute cooldown per session per kind of announcement.
 *
 * Not a rate limit in the feedback-endpoint sense — these routes are
 * admin-only, so nobody untrusted can reach them. It's a double-send guard.
 * The dashboard disables the button while a send is in flight, but a bulk send
 * takes ten to thirty seconds, which is long enough for an organizer to decide
 * it's hung and reload, or open the dashboard in a second tab. Either one
 * would put a duplicate email in twenty inboxes.
 *
 * Keyed on the session rather than the admin, because the thing being
 * protected is the mailing list: two admins hitting "notify" a few seconds
 * apart send the players two emails just as surely as one admin doing it
 * twice.
 *
 * A minute rather than something longer because a legitimate re-send is a
 * normal thing to want — a note with a typo in it, or a retry after a partial
 * failure — and making the organizer wait out a long cooldown for that would
 * push them towards texting everyone instead.
 *
 * Fails open with no Redis configured, like every other use of
 * checkRateLimit: local dev and preview deploys keep working, and the worst
 * case is the duplicate email this exists to prevent.
 *
 * Spent before the send rather than after it, so a send that turns out to have
 * no audience still burns the minute. Deliberate: moving the check after the
 * audience is known would mean threading Redis through announcements.ts to
 * close a gap the dashboard already covers, since both buttons are disabled
 * when their audience is empty.
 */
const COOLDOWN_SECONDS = 60;

export type AnnouncementKind = 'notify' | 'payment-reminders';

export async function guardAnnouncement(kind: AnnouncementKind, sessionId: string): Promise<void> {
  const allowed = await checkRateLimit(`announce:${kind}:${sessionId}`, 1, COOLDOWN_SECONDS);
  if (!allowed) {
    throw new ApiError(
      429,
      `That was just sent. Wait a minute before sending it again, so nobody gets it twice.`
    );
  }
}
