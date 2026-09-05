import { getSessionByAnyId, createSession, updateSession } from '../sheets/sessions';
import { currentWeekGameDayCandidates, isNearEasternTime } from './time';

export const DEFAULT_GAME_TIME = process.env.SESSION_DEFAULT_GAME_TIME || '18:00';
export const DEFAULT_CAPACITY = Number(process.env.SESSION_DEFAULT_CAPACITY) || 20;

// GitHub Actions can be several minutes late firing a scheduled workflow,
// but the "wrong DST offset" duplicate firing is a full hour off — this
// window is wide enough to absorb normal scheduling jitter while still
// clearly rejecting that duplicate.
const CRON_TOLERANCE_MINUTES = 30;

export interface ScheduleResult {
  sessionId: string;
  skipped: boolean;
  reason?: string;
}

/**
 * Monday 9am ET (Section 1): open registration for the upcoming week's
 * session, creating a default Friday one if an admin hasn't already set
 * one up for Friday, Saturday, or Sunday. Section 8 treats capacity as
 * an admin-adjustable field, so an admin wanting a non-default
 * capacity/time (or a Saturday/Sunday game) can create or edit the
 * session ahead of time — this just guarantees *something* opens even if
 * they didn't get to it.
 */
export async function openRegistrationForUpcomingSession(now: Date = new Date()): Promise<ScheduleResult> {
  const candidates = currentWeekGameDayCandidates(now);
  const defaultSessionId = candidates[0]; // Friday

  if (!isNearEasternTime(9, 0, CRON_TOLERANCE_MINUTES, now)) {
    return { sessionId: defaultSessionId, skipped: true, reason: 'Not currently ~9am ET — likely the DST-offset duplicate cron firing.' };
  }

  const existing = await getSessionByAnyId(candidates);
  if (!existing) {
    await createSession({
      sessionId: defaultSessionId,
      gameDate: defaultSessionId,
      gameTime: DEFAULT_GAME_TIME,
      registrationOpensAt: now.toISOString(),
      registrationClosesAt: '',
      capacity: DEFAULT_CAPACITY,
      cost: 0,
      status: 'open',
    });
    return { sessionId: defaultSessionId, skipped: false };
  }

  await updateSession(existing.sessionId, { status: 'open', registrationOpensAt: now.toISOString() });
  return { sessionId: existing.sessionId, skipped: false };
}

/** Wednesday 9pm ET (Section 1): close registration for this week's session,
 * whichever of Friday/Saturday/Sunday it was scheduled on. */
export async function closeRegistrationForCurrentSession(now: Date = new Date()): Promise<ScheduleResult> {
  const candidates = currentWeekGameDayCandidates(now);

  if (!isNearEasternTime(21, 0, CRON_TOLERANCE_MINUTES, now)) {
    return { sessionId: candidates[0], skipped: true, reason: 'Not currently ~9pm ET — likely the DST-offset duplicate cron firing.' };
  }

  const existing = await getSessionByAnyId(candidates);
  if (!existing) {
    return { sessionId: candidates[0], skipped: true, reason: 'No session exists for this week — nothing to close.' };
  }

  await updateSession(existing.sessionId, { status: 'closed', registrationClosesAt: now.toISOString() });
  return { sessionId: existing.sessionId, skipped: false };
}
