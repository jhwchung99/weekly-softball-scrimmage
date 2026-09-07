import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/auth';
import { getSession } from '../../../../../../sheets/sessions';
import { listSignupsForSession } from '../../../../../../sheets/signups';
import { generateTeams, saveTeams, postTeams, teamsFromSignups, teamCountFor } from '../../../../../../lib/teamFlow';
import { withMutationLock } from '../../../../../../lib/lock';
import { ApiError, handleApiError } from '../../../../../../lib/apiErrors';

type Params = { params: Promise<{ sessionId: string }> };

/** The current draft or posted teams, rebuilt from the stored assignments. */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');

    const signups = await listSignupsForSession(sessionId);
    return NextResponse.json({
      teamsStatus: session.teamsStatus,
      numFields: session.numFields,
      teams: teamsFromSignups(signups, teamCountFor(session)),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * `generate` draws a fresh pass, discarding any manual edits; `post` publishes
 * what is currently saved. Anything else is a save of the edited rosters.
 *
 * Editing is entirely client-side until one of these is called, so moving
 * players around costs nothing.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));

    if (body?.action === 'generate') {
      const teams = await withMutationLock(() => generateTeams(sessionId));
      return NextResponse.json({ teams, teamsStatus: 'draft' });
    }

    if (body?.action === 'post') {
      const session = await postTeams(sessionId);
      return NextResponse.json({ teamsStatus: session.teamsStatus });
    }

    const assignments = Array.isArray(body?.assignments) ? body.assignments : null;
    if (!assignments) throw new ApiError(400, 'Provide assignments, or an action of "generate" or "post".');

    const cleaned = assignments.map((a: unknown) => {
      const row = a as { signupId?: unknown; teamName?: unknown };
      if (typeof row?.signupId !== 'string' || typeof row?.teamName !== 'string') {
        throw new ApiError(400, 'Each assignment needs a signupId and a teamName.');
      }
      return { signupId: row.signupId, teamName: row.teamName };
    });

    await withMutationLock(() => saveTeams(sessionId, cleaned));
    return NextResponse.json({ ok: true, teamsStatus: 'draft' });
  } catch (err) {
    return handleApiError(err);
  }
}
