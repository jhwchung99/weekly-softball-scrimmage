import { NextRequest, NextResponse } from 'next/server';
import { getSessionEmail } from '../../../../lib/auth';
import { getPlayer, upsertPlayer } from '../../../../sheets/players';
import { ApiError, handleApiError } from '../../../../lib/apiErrors';
import { validatePlayerProfile } from '../../../../lib/validation';

export async function GET() {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const player = await getPlayer(email);
    return NextResponse.json({ player });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    // Guarded like every other mutation route — an unparseable body is a
    // client error (400 from validatePlayerProfile), not a server fault.
    const body = await request.json().catch(() => ({}));
    const profile = validatePlayerProfile(body ?? {});

    await upsertPlayer({ email, ...profile });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
