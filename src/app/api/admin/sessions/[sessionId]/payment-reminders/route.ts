import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { nudgeUnpaidPlayers } from '../../../../../../lib/announcements';
import { guardAnnouncement } from '../../../../../../lib/announcementGuard';
import { handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/** Same request-time bulk send as the notify route, over a strictly smaller
 * audience — everyone unpaid is a subset of everyone confirmed. */
export const maxDuration = 60;

/** Nudge the confirmed players who still owe for their spot. The dashboard
 * has shown an unpaid count since payments were added; this is the part that
 * does something about it. */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;

    await guardAnnouncement('payment-reminders', sessionId);
    const result = await nudgeUnpaidPlayers(sessionId);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
