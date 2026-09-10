import { NextResponse } from 'next/server';
import { requireSignedIn } from '../../../../../../lib/auth';
import { respondToSubRequest } from '../../../../../../lib/subRequestFlow';
import { ApiError, handleApiError } from '../../../../../../lib/apiErrors';
import { mySignupView } from '../../../../../../lib/views';

type Params = { params: Promise<{ signupId: string }> };

/**
 * `signupId` is the REQUESTER's row (where the pending request lives) —
 * the caller is the responder, identified by their session email
 * matching that row's subRequestTargetEmail (checked inside
 * respondToSubRequest).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const email = await requireSignedIn();

    const { signupId } = await params;
    const body = await request.json().catch(() => ({}));
    const accept = Boolean(body?.accept);

    const signup = mySignupView(await respondToSubRequest(signupId, email, accept));
    return NextResponse.json({ signup });
  } catch (err) {
    return handleApiError(err);
  }
}
