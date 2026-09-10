import { NextResponse } from 'next/server';
import { requireSignedIn } from '../../../../../lib/auth';
import { isAdminEmail } from '../../../../../sheets/admins';
import { cancelMySignup } from '../../../../../lib/signupFlow';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ signupId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const email = await requireSignedIn();

    const { signupId } = await params;
    const isAdmin = await isAdminEmail(email);
    const { promoted } = await cancelMySignup(signupId, email, isAdmin);
    return NextResponse.json({ ok: true, promoted });
  } catch (err) {
    return handleApiError(err);
  }
}
