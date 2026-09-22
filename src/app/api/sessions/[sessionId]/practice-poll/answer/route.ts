import { NextResponse } from 'next/server';
import { requireSignedIn } from '../../../../../../lib/auth';
import { answerPracticePoll } from '../../../../../../lib/practicePollFlow';
import { validatePracticePollAnswer } from '../../../../../../lib/validation';
import { handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/**
 * One player answering the practice poll, or changing their answer.
 *
 * The email comes from the signed-in session and never from the body, so a
 * player can only answer for themselves. Everything else the answer depends
 * on — the poll being open, the caller being confirmed — is the flow's to
 * check, since the same rules have to hold whatever calls it.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const email = await requireSignedIn();
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const answer = validatePracticePollAnswer(body);

    const signup = await answerPracticePoll(sessionId, email, answer);
    return NextResponse.json({ ok: true, answer: signup.practicePollAnswer });
  } catch (err) {
    return handleApiError(err);
  }
}
