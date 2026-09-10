import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../../../lib/auth';
import { requestSub, cancelSubRequest } from '../../../../../lib/subRequestFlow';
import { validateEmail } from '../../../../../lib/validation';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ signupId: string }> };

/** A waitlisted player proposes to share targetEmail's slot. */
export async function POST(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { signupId } = await params;
    const body = await request.json().catch(() => ({}));
    const targetEmail = validateEmail(body?.targetEmail);

    const signup = await requestSub(signupId, email, targetEmail);
    return NextResponse.json({ signup }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

/** The requester withdraws their own pending request. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { signupId } = await params;
    const signup = await cancelSubRequest(signupId, email);
    return NextResponse.json({ signup });
  } catch (err) {
    return handleApiError(err);
  }
}
