import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../../../../lib/auth';
import { respondToSubRequest } from '../../../../../../lib/subRequestFlow';
import { ApiError, handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ signupId: string }> };

/**
 * `signupId` is the REQUESTER's row (where the pending request lives) —
 * the caller is the responder, identified by their session email
 * matching that row's subRequestTargetEmail (checked inside
 * respondToSubRequest).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { signupId } = await params;
    const body = await request.json().catch(() => ({}));
    const accept = Boolean(body?.accept);

    const signup = await respondToSubRequest(signupId, email, accept);
    return NextResponse.json({ signup });
  } catch (err) {
    return handleApiError(err);
  }
}
