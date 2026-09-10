import { getSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession, batchUpdateSignups } from '../sheets/signups';
import { Session, Signup } from '../sheets/schema';
import { ApiError } from './apiErrors';
import { buildTeams, Team } from './teams';
import { sendTeamsReadyAlert, deliver } from './notifications';
import { phaseOf, isRosterLocked } from './sessionPhase';
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

/**
 * The cron's entry point: generate once, after the lock, then tell the
 * organizer.
 *
 * Idempotent on `teamsStatus`, which is what lets this run hourly without
 * caring about DST duplicate firings the way the fixed-time crons have to.
 */
export async function generateTeamsIfDue(
  sessionId: string,
  now: Date = new Date()
): Promise<{ generated: boolean; reason?: string }> {
  return withMutationLock(async () => {
    const session = await getSession(sessionId);
    if (!session) return { generated: false, reason: 'No session for this week.' };
    if (session.status === 'cancelled') return { generated: false, reason: 'Session is cancelled.' };
    if (session.teamsStatus !== '') return { generated: false, reason: `Teams already ${session.teamsStatus}.` };

    if (!isRosterLocked(phaseOf(session, now))) return { generated: false, reason: 'Roster has not locked yet.' };

    const teams = await generateTeams(sessionId);

    // Awaited but swallowed, like every other organizer alert: the teams are
    // already saved, and a failed push shouldn't undo that.
    await deliver(`teams-ready alert for session ${sessionId}`, () => sendTeamsReadyAlert(session, teams));
    return { generated: true };
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
