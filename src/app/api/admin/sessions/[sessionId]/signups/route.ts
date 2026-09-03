import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { listSignupsForSession } from '../../../../../../sheets/signups';
import { adminAddSignup } from '../../../../../../lib/adminFlow';
import { ApiError, handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/** Full roster + waitlist for a session, Section 8's "view the full roster
 * and waitlist" — unlike the player-facing status check, this returns
 * every signup regardless of status (including cancelled), since an
 * admin needs the complete picture. */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const signups = await listSignupsForSession(sessionId);
    return NextResponse.json({ signups });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Manually add a signup on someone's behalf (Section 8). */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));

    const email = typeof body?.email === 'string' ? body.email : '';
    if (!email) throw new ApiError(400, 'email is required.');

    const profile =
      body?.profile && typeof body.profile === 'object'
        ? {
            fullName: String(body.profile.fullName ?? ''),
            gender: String(body.profile.gender ?? ''),
            age: Number(body.profile.age ?? 0),
            savedPositions: typeof body.profile.savedPositions === 'string' ? body.profile.savedPositions : '',
          }
        : undefined;

    const invitedByName = typeof body?.invitedByName === 'string' ? body.invitedByName : undefined;
    const willingToShare = Boolean(body?.willingToShare);
    const waiverAccepted = Boolean(body?.waiverAccepted);

    const signup = await adminAddSignup({ sessionId, email, profile, invitedByName, willingToShare, waiverAccepted });
    return NextResponse.json({ signup }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
