import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { setPracticePollStatus } from '../../../../../../lib/practicePollFlow';
import { notifyPracticePollOpen } from '../../../../../../lib/announcements';
import { validatePracticePoll } from '../../../../../../lib/validation';
import { guardAnnouncement, releaseAnnouncement } from '../../../../../../lib/announcementGuard';
import { handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/** Only reached when the organizer ticks the notify box, and then it is the
 * same bulk send the other announcement routes cost out at ~0.8s a head. */
export const maxDuration = 60;

/**
 * Open or close this week's practice poll.
 *
 * The send is opt-in and only on open. Closing a poll mails nobody, which is
 * deliberate: the organizer asked for the decision to stay theirs to
 * announce, and an app that mails twenty people the moment a poll shuts is
 * not "flexible and manual".
 *
 * The guard is spent only when something will actually be sent, unlike the
 * notify route where sending is the whole request. A silent open or close is
 * not a duplicate-email risk, so making it burn the cooldown would lock the
 * organizer out of a send they had not made yet.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const { status, closesAt, notify } = validatePracticePoll(body);

    if (status === 'open' && notify) {
      // Before anything is written: a refused send used to leave the poll open
      // with nobody told, and the dashboard saying only that it failed.
      await guardAnnouncement('practice-poll', sessionId);
      try {
        const session = await setPracticePollStatus(sessionId, status, closesAt);
        const announcement = await notifyPracticePollOpen(sessionId);
        return NextResponse.json({ session, announcement });
      } catch (err) {
        // Both steps throw only before the first email (each send is caught on
        // its own), so nobody was mailed and the minute can be given back.
        await releaseAnnouncement('practice-poll', sessionId);
        throw err;
      }
    }

    const session = await setPracticePollStatus(sessionId, status, closesAt);
    return NextResponse.json({ session });
  } catch (err) {
    return handleApiError(err);
  }
}
