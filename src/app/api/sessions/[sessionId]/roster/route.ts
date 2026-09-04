import { NextResponse } from 'next/server';
import { getSessionEmail } from '../../../../../lib/auth';
import { listSignupsForSession } from '../../../../../sheets/signups';
import { Signup } from '../../../../../sheets/schema';
import { ApiError, handleApiError } from '../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

interface RosterEntry {
  fullName: string;
  positions: string;
  pairedWith: string | null;
}

function toEntry(s: Signup, active: Signup[]): RosterEntry {
  const pairedWith = s.pairId ? active.find((o) => o.pairId === s.pairId && o.signupId !== s.signupId)?.fullName ?? null : null;
  return { fullName: s.fullName, positions: s.positions, pairedWith };
}

/**
 * Player-facing roster — who's confirmed and who's waitlisted, by name
 * only (no email — this deliberately doesn't hand out everyone's
 * address; a sub request assumes the requester already personally knows
 * who they'd ask). Any signed-in user can view, not just admins — this
 * is what makes a sub request possible in the first place.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const email = await getSessionEmail();
    if (!email) throw new ApiError(401, 'Not signed in.');

    const { sessionId } = await params;
    const signups = await listSignupsForSession(sessionId);
    const active = signups.filter((s) => s.status !== 'cancelled');

    const confirmed = active.filter((s) => s.status === 'confirmed').map((s) => toEntry(s, active));
    const waitlisted = active
      .filter((s) => s.status === 'waitlisted')
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((s) => toEntry(s, active));

    return NextResponse.json({ confirmed, waitlisted });
  } catch (err) {
    return handleApiError(err);
  }
}
