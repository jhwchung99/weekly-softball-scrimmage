import { getSession, createSession, updateSession } from '../sheets/sessions';
import { currentWeekFridayEastern, isNearEasternTime } from './time';

const DEFAULT_GAME_TIME = process.env.SESSION_DEFAULT_GAME_TIME || '18:00';
const DEFAULT_CAPACITY = Number(process.env.SESSION_DEFAULT_CAPACITY) || 20;

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
 * Monday 9am ET (Section 1): open registration for the upcoming Friday's
 * session, creating it with defaults if an admin hasn't already set one
 * up. Section 8 treats capacity as an admin-adjustable field, so an
 * admin wanting a non-default capacity/time can create or edit the
 * session ahead of time — this just guarantees *something* opens even if
 * they didn't get to it.
 */
export async function openRegistrationForUpcomingSession(now: Date = new Date()): Promise<ScheduleResult> {
  const sessionId = currentWeekFridayEastern(now);

  if (!isNearEasternTime(9, 0, CRON_TOLERANCE_MINUTES, now)) {
    return { sessionId, skipped: true, reason: 'Not currently ~9am ET — likely the DST-offset duplicate cron firing.' };
  }

  const existing = await getSession(sessionId);
  if (!existing) {
    await createSession({
      sessionId,
      gameDate: sessionId,
      gameTime: DEFAULT_GAME_TIME,
      registrationOpensAt: now.toISOString(),
      registrationClosesAt: '',
      capacity: DEFAULT_CAPACITY,
      cost: 0,
      status: 'open',
    });
    return { sessionId, skipped: false };
  }

  await updateSession(sessionId, { status: 'open', registrationOpensAt: now.toISOString() });
  return { sessionId, skipped: false };
}

/** Wednesday 9pm ET (Section 1): close registration for this week's session. */
export async function closeRegistrationForCurrentSession(now: Date = new Date()): Promise<ScheduleResult> {
  const sessionId = currentWeekFridayEastern(now);

  if (!isNearEasternTime(21, 0, CRON_TOLERANCE_MINUTES, now)) {
    return { sessionId, skipped: true, reason: 'Not currently ~9pm ET — likely the DST-offset duplicate cron firing.' };
  }

  const existing = await getSession(sessionId);
  if (!existing) {
    return { sessionId, skipped: true, reason: 'No session exists for this week — nothing to close.' };
  }

  await updateSession(sessionId, { status: 'closed', registrationClosesAt: now.toISOString() });
  return { sessionId, skipped: false };
}
