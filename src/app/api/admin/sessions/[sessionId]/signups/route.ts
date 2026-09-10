import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { listSignupsForSession } from '../../../../../../sheets/signups';
import { adminAddSignup } from '../../../../../../lib/adminFlow';
import { ApiError, handleApiError } from '../../../../../../lib/apiErrors';
import { adminRosterView } from '../../../../../../lib/views';

type Params = { params: Promise<{ sessionId: string }> };

/**
 * Full roster + waitlist for a session, Section 8's "view the full roster and
 * waitlist" — unlike the player-facing status check, this returns every signup
 * regardless of status (including cancelled), since an admin needs the
 * complete picture.
 *
 * Projected like every other payload. Being admin-only is why the extra fields
 * would not be a disclosure; it is not a reason to send the console a waiver
 * text and a set of sub-request internals it never reads.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const signups = await listSignupsForSession(sessionId);
    return NextResponse.json({ signups: adminRosterView(signups) });
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
            savedPositions: typeof body.profile.savedPositions === 'string' ? body.profile.savedPositions : '',
          }
        : undefined;

    const invitedByName = typeof body?.invitedByName === 'string' ? body.invitedByName : undefined;
    const willingToShare = Boolean(body?.willingToShare);
    const waiverAccepted = Boolean(body?.waiverAccepted);

    // Same lock as the player-facing signup route: this runs the identical
    // capacity accounting, so without it an admin add racing a player signup
    // can read "room available" twice and oversubscribe the roster.
    const created = await adminAddSignup({ sessionId, email, profile, invitedByName, willingToShare, waiverAccepted });
    return NextResponse.json({ signup: adminRosterView([created])[0] }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
