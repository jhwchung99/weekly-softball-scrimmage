import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../../../lib/auth';
import { isAdminEmail } from '../../../../../sheets/admins';
import { cancelMySignup } from '../../../../../lib/signupFlow';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';
import { withMutationLock } from '../../../../../lib/lock';

type Params = { params: Promise<{ signupId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { signupId } = await params;
    const isAdmin = await isAdminEmail(email);
    const { promoted } = await withMutationLock(() => cancelMySignup(signupId, email, isAdmin));
    return NextResponse.json({ ok: true, promoted });
  } catch (err) {
    return handleApiError(err);
  }
}
