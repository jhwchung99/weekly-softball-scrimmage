import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { notifySessionChange } from '../../../../../../lib/announcements';
import { validateAnnouncementNote } from '../../../../../../lib/validation';
import { guardAnnouncement } from '../../../../../../lib/announcementGuard';
import { handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/**
 * A bulk send inside a request handler, which the game-day reminder
 * deliberately avoids (see scheduling.ts). It's the right trade here: the
 * organizer pressed a button and is waiting to be told how many people heard
 * about the rainout, and a fire-and-forget job that answered "probably fine"
 * would be useless for exactly the message that matters most.
 *
 * Costed at ~0.8s per recipient — the Gmail call plus SEND_GAP_MS — so a
 * 40-player two-field roster lands around 32s.
 */
export const maxDuration = 60;

/** Email this session's players its current details, or the news that it's
 * cancelled. Section 8's session controls, minus the guessing about when a
 * change is worth an email — an admin decides that by pressing this. */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const note = validateAnnouncementNote(body?.note);

    await guardAnnouncement('notify', sessionId);
    const result = await notifySessionChange(sessionId, note);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
