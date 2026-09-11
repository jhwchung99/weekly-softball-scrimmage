import { getSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession, batchUpdateSignups } from '../sheets/signups';
import { Session, Signup } from '../sheets/schema';
import { ApiError } from './apiErrors';
import { buildTeams, Team } from './teams';
import { withMutationLock } from './lock';

/** Teams = one per half of each booked diamond. */
export function teamCountFor(session: Pick<Session, 'numFields'>): number {
  return Math.max(1, session.numFields || 1) * 2;
}

/** Only people who are actually playing get sorted into teams. */
function playersFor(signups: Signup[]): Signup[] {
  return signups.filter((s) => s.status === 'confirmed');
}

/**
 * Runs the generator and writes the result as a draft.
 *
 * Pressed by the organizer; there is no scheduled caller. It used to run off
 * an hourly cron, which was dropped once GitHub Actions proved to drop most
 * firings — and the button had always existed anyway.
 *
 * Every assignment goes out in one batched call rather than a write per
 * player, and `teamsStatus` moves to 'draft' so players still see nothing
 * until the organizer posts.
 */
export async function generateTeams(sessionId: string): Promise<Team[]> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');

    const signups = await listSignupsForSession(sessionId);
    const teams = buildTeams(playersFor(signups), teamCountFor(session));

    const updates = teams.flatMap((t) => t.members.map((m) => ({ signupId: m.signupId, updates: { teamName: t.name } })));
    if (updates.length > 0) await batchUpdateSignups(updates);
    await updateSession(sessionId, { teamsStatus: 'draft' });

    return teams;
  });
}

/** Writes the organizer's edited rosters. One batched call, not one per move. */
export async function saveTeams(sessionId: string, assignments: { signupId: string; teamName: string }[]): Promise<void> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');

    const signups = await listSignupsForSession(sessionId);
    const known = new Set(signups.map((s) => s.signupId));
    const unknown = assignments.filter((a) => !known.has(a.signupId));
    if (unknown.length > 0) throw new ApiError(400, 'One or more signups do not belong to this session.');

    if (assignments.length > 0) {
      await batchUpdateSignups(assignments.map((a) => ({ signupId: a.signupId, updates: { teamName: a.teamName } })));
    }
    if (session.teamsStatus === '') await updateSession(sessionId, { teamsStatus: 'draft' });
  });
}

/** Makes the saved rosters visible to players. Touches no signup row. */
export async function postTeams(sessionId: string): Promise<Session> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) throw new ApiError(404, 'No such session.');
    if (session.teamsStatus === '') throw new ApiError(409, 'There are no teams to post yet.');
    return updateSession(sessionId, { teamsStatus: 'posted' });
  });
}
