import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../../../lib/auth';
import { signUpForSession, signUpAsGuestForSession, getMyStatusForSession } from '../../../../../lib/signupFlow';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';
import { validateInvitedByName } from '../../../../../lib/validation';

type Params = { params: Promise<{ sessionId: string }> };

/**
 * Member vs. guest is decided by the request body, not a separate route
 * (Section 5: "Guests answer two extra questions") — presence of
 * `invitedByName` means this is a guest signup.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    // Presence (before validation) decides member vs. guest routing;
    // once routed to the guest path, the value itself is validated.
    const rawInvitedByName = typeof body?.invitedByName === 'string' ? body.invitedByName : '';
    const waiverAccepted = Boolean(body?.waiverAccepted);

    const signup = rawInvitedByName
      ? await signUpAsGuestForSession(
          sessionId,
          email,
          validateInvitedByName(rawInvitedByName),
          Boolean(body?.willingToShare),
          waiverAccepted
        )
      : await signUpForSession(sessionId, email, waiverAccepted);

    return NextResponse.json({ signup }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

/** "My status for this session" — Step 5's third API route. Also
 * carries incoming sub requests and this caller's cost share, so the
 * homepage can render everything from one call. */
export async function GET(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { sessionId } = await params;
    // Forwarded whole rather than destructured field by field: this route
    // previously listed three of the four and silently dropped
    // waitlistPosition, so a waitlisted player asking here was told nothing
    // about where they stood while the homepage told them exactly. `MyStatus`
    // is already the shape this endpoint returns, so naming the fields again
    // only creates somewhere for them to go missing.
    return NextResponse.json(await getMyStatusForSession(sessionId, email));
  } catch (err) {
    return handleApiError(err);
  }
}
