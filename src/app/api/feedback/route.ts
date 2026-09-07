import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth';
import { ApiError, handleApiError } from '../../../lib/apiErrors';
import { validateFeedback } from '../../../lib/validation';
import { recordFeedback } from '../../../lib/feedback';
import { checkRateLimit } from '../../../lib/rateLimit';

// Generous enough that nobody hits it reporting a genuine problem, low
// enough that the organizer's phone can't be used as a doorbell.
const FEEDBACK_LIMIT = 5;
const FEEDBACK_WINDOW_SECONDS = 60 * 60;

/**
 * Records a player's bug report or suggestion on the Feedback tab, and
 * pushes the organizer a note that one arrived.
 *
 * Sign-in is required, which is the main abuse control: this route puts
 * caller-supplied text on someone's phone, and an anonymous version of
 * that is a spam target on the public internet. It also means every
 * report arrives attributable, so the organizer can reply.
 *
 * Costs one Sheets *write* and no reads at all, so a burst of feedback
 * can't eat into the read quota that signups depend on.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) throw new ApiError(401, 'Please sign in before sending feedback.');

    // Validated before the rate limit is charged, so a malformed body
    // doesn't burn an attempt the reporter never knowingly used.
    const body = await request.json().catch(() => ({}));
    const feedback = validateFeedback(body ?? {});

    const allowed = await checkRateLimit(`feedback:${user.email}`, FEEDBACK_LIMIT, FEEDBACK_WINDOW_SECONDS);
    if (!allowed) {
      throw new ApiError(429, "You've sent a few reports already. Please try again in an hour.");
    }

    await recordFeedback({ ...feedback, fromEmail: user.email, fromName: user.name });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
