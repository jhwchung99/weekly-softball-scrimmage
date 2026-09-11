import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { sendRemindersForSession } from '../../../../../../lib/scheduling';
import { guardAnnouncement } from '../../../../../../lib/announcementGuard';
import { handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/** Same request-time bulk send as the notify and payment-reminder routes: the
 * organizer pressed a button and is waiting to be told how many people heard. */
export const maxDuration = 60;

/**
 * The game-day email, sent by hand.
 *
 * This used to be a cron at 9am ET. GitHub Actions dropped roughly four
 * scheduled firings in five on this repo, and the job's own 59-minute window
 * made a late firing refuse to send — so the email had never once gone out.
 * It is a button now, and `sendRemindersForSession` gates on the roster lock
 * rather than on a clock, which is what makes the copy honest at any hour.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;

    await guardAnnouncement('game-day-email', sessionId);
    const result = await sendRemindersForSession(sessionId);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
