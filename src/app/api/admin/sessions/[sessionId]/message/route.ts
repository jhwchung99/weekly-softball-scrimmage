import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { sendMessageToPlayers } from '../../../../../../lib/announcements';
import { validatePlayerMessage } from '../../../../../../lib/validation';
import { guardAnnouncement } from '../../../../../../lib/announcementGuard';
import { handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/** The same bulk send the notify route costs out: roughly 0.8s per recipient,
 * so a full roster lands well inside a minute. */
export const maxDuration = 60;

/**
 * Email this session's players something the organizer wrote in full.
 *
 * Separate from the notify route because the request is a different shape:
 * that one takes an optional note onto a generated email, this one takes the
 * whole email and would be meaningless without it. Its own guard key too, so
 * sending a message does not lock out a rainout notice for a minute.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const { subject, message, includeWaitlisted } = validatePlayerMessage(body);

    await guardAnnouncement('message', sessionId);
    const result = await sendMessageToPlayers(sessionId, subject, message, includeWaitlisted);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
