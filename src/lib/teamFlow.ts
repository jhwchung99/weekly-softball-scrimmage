import { getSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession, batchUpdateSignups } from '../sheets/signups';
import { Session, Signup } from '../sheets/schema';
import { ApiError } from './apiErrors';
import { buildTeams, analyzeTeam, Team, Rosterable } from './teams';
import { sendTeamsReadyAlert } from './notifications';
import { getWeeklyMilestones } from './time';

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
  const session = await getSession(sessionId);
  if (!session) throw new ApiError(404, 'No such session.');

  const signups = await listSignupsForSession(sessionId);
  const teams = buildTeams(playersFor(signups), teamCountFor(session));

  const updates = teams.flatMap((t) => t.members.map((m) => ({ signupId: m.signupId, updates: { teamName: t.name } })));
  if (updates.length > 0) await batchUpdateSignups(updates);
  await updateSession(sessionId, { teamsStatus: 'draft' });

  return teams;
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
  const session = await getSession(sessionId);
  if (!session) return { generated: false, reason: 'No session for this week.' };
  if (session.status === 'cancelled') return { generated: false, reason: 'Session is cancelled.' };
  if (session.teamsStatus !== '') return { generated: false, reason: `Teams already ${session.teamsStatus}.` };

  const { cutoffStart } = getWeeklyMilestones(session.gameDate, session.gameTime);
  if (now < cutoffStart) return { generated: false, reason: 'Roster has not locked yet.' };

  const teams = await generateTeams(sessionId);

  // Awaited but swallowed, like every other organizer alert: the teams are
  // already saved, and a failed push shouldn't undo that.
  try {
    await sendTeamsReadyAlert(session, teams);
  } catch (err) {
    console.error(`Failed to send teams-ready alert for session ${sessionId}:`, err);
  }
  return { generated: true };
}

/** Writes the organizer's edited rosters. One batched call, not one per move. */
export async function saveTeams(sessionId: string, assignments: { signupId: string; teamName: string }[]): Promise<void> {
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
}

/** Makes the saved rosters visible to players. Touches no signup row. */
export async function postTeams(sessionId: string): Promise<Session> {
  const session = await getSession(sessionId);
  if (!session) throw new ApiError(404, 'No such session.');
  if (session.teamsStatus === '') throw new ApiError(409, 'There are no teams to post yet.');
  return updateSession(sessionId, { teamsStatus: 'posted' });
}

/**
 * The one thing a signup row contributes to a lineup: who they are and what
 * they cover.
 *
 * Constructed field by field rather than spread, because this is the boundary
 * where a player's row stops being an admin record and becomes something their
 * teammates read. `Team.members` has always been declared as `Rosterable`, but
 * a whole `Signup` satisfies that shape structurally, so forwarding rows
 * type-checked while shipping email addresses, payments, attendance and waiver
 * text to everyone on the field. The same boundary `roster.ts` draws with
 * `toEntry` — see planner/2026-09-09-architecture-review.html, candidate 1.
 */
function toMember(s: Signup): Rosterable {
  return {
    signupId: s.signupId,
    fullName: s.fullName,
    gender: s.gender,
    positions: s.positions,
    pairId: s.pairId,
  };
}

/**
 * Rebuilds the team view from stored `teamName` values, for display.
 *
 * Cancelled signups are filtered out, which is the whole implementation of
 * "if someone cancels after teams are posted, that team plays a person
 * short": their row simply stops appearing, and the note under the team
 * recomputes to show what they took with them.
 */
export function teamsFromSignups(signups: Signup[], teamCount: number): Team[] {
  const active = signups.filter((s) => s.status === 'confirmed' && s.teamName);
  const names = Array.from({ length: teamCount }, (_, i) => `Team ${i + 1}`);
  for (const s of active) if (!names.includes(s.teamName)) names.push(s.teamName);

  return names.map((name) => {
    const members = active.filter((s) => s.teamName === name).map(toMember);
    return { name, members, ...analyzeTeam(members) };
  });
}
