import { getSessionByAnyId, createSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession } from '../sheets/signups';
import { currentWeekGameDayCandidates, isNearEasternTime, todayEastern } from './time';
import { countConfirmedSlots, computeCostShare } from './payments';
import { sendOpenSpotsAlert, sendGameDayReminderEmail } from './notifications';

export const DEFAULT_GAME_TIME = process.env.SESSION_DEFAULT_GAME_TIME || '18:00';
export const DEFAULT_CAPACITY = Number(process.env.SESSION_DEFAULT_CAPACITY) || 20;
// What one spot costs a player. Fixed rather than derived from the permit
// total so the number is stable and knowable at signup time — see
// planner/2026-09-05-location-payments-qol-plan.md, section 3.
export const DEFAULT_PRICE_PER_SPOT = Number(process.env.SESSION_DEFAULT_PRICE_PER_SPOT) || 0;

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
      pricePerSpot: DEFAULT_PRICE_PER_SPOT,
      locationArea: '',
      locationName: '',
      locationUrl: '',
      status: 'open',
    });
    return { sessionId: defaultSessionId, skipped: false };
  }

  await updateSession(existing.sessionId, { status: 'open', registrationOpensAt: now.toISOString() });
  return { sessionId: existing.sessionId, skipped: false };
}

/**
 * Tuesday 12am ET (Section 1): close registration for this week's
 * session, whichever of Friday/Saturday/Sunday it was scheduled on.
 * Short on purpose (~15 hours after Monday's open) — gives the organizer
 * the rest of the week to book a permit sized to the actual headcount.
 *
 * If capacity still has room once registration closes, the organizer
 * gets pushed an alert (not in the original guidelines) so an empty
 * permit slot doesn't go unnoticed until game day — same
 * awaited-but-swallowed pattern as the other organizer alerts in
 * notifications.ts: a failed push shouldn't affect the close itself,
 * which has already succeeded by that point.
 */
export async function closeRegistrationForCurrentSession(now: Date = new Date()): Promise<ScheduleResult> {
  const candidates = currentWeekGameDayCandidates(now);

  if (!isNearEasternTime(0, 0, CRON_TOLERANCE_MINUTES, now)) {
    return { sessionId: candidates[0], skipped: true, reason: 'Not currently ~12am ET — likely the DST-offset duplicate cron firing.' };
  }

  const existing = await getSessionByAnyId(candidates);
  if (!existing) {
    return { sessionId: candidates[0], skipped: true, reason: 'No session exists for this week — nothing to close.' };
  }

  await updateSession(existing.sessionId, { status: 'closed', registrationClosesAt: now.toISOString() });

  const signups = await listSignupsForSession(existing.sessionId);
  const openSpots = existing.capacity - countConfirmedSlots(signups);
  if (openSpots > 0) {
    try {
      await sendOpenSpotsAlert(existing, openSpots);
    } catch (err) {
      console.error(`Failed to send open-spots alert for session ${existing.sessionId}:`, err);
    }
  }

  return { sessionId: existing.sessionId, skipped: false };
}

/**
 * Game-day reminder to everyone confirmed: when, where, and what they owe.
 *
 * This is the app's only *bulk* send — every other email goes to one or two
 * people — which drives two decisions:
 *
 * 1. **It runs from the cron, not a request handler.** ~20 sequential Gmail
 *    calls is ~10s of wall clock, uncomfortably close to serverless function
 *    limits. GitHub Actions has a far more generous time budget.
 * 2. **Sends are sequential with a small gap.** The Gmail API costs ~100 quota
 *    units per send against ~250 units/user/second, so a Promise.all burst
 *    would trip the rate limit. Volume is not the constraint — ~20 emails a
 *    week against a ~500/day sending limit is under 5% of one day's
 *    allowance — the burst rate is.
 *
 * One failure never aborts the rest: same awaited-but-swallowed pattern as
 * every other notification here.
 */
const SEND_GAP_MS = 500;

export interface ReminderResult {
  sessionId: string;
  skipped: boolean;
  reason?: string;
  sent?: number;
  failed?: number;
}

export async function sendGameDayReminders(now: Date = new Date()): Promise<ReminderResult> {
  const candidates = currentWeekGameDayCandidates(now);

  // Without this, the seasonal DST duplicate firing would pass the game-day
  // date check just as happily as the real one and everybody would get the
  // reminder twice.
  if (!isNearEasternTime(9, 0, CRON_TOLERANCE_MINUTES, now)) {
    return { sessionId: candidates[0], skipped: true, reason: 'Not currently ~9am ET — likely the DST-offset duplicate cron firing.' };
  }

  const session = await getSessionByAnyId(candidates);
  if (!session) {
    return { sessionId: candidates[0], skipped: true, reason: 'No session exists for this week.' };
  }
  if (session.status === 'cancelled') {
    return { sessionId: session.sessionId, skipped: true, reason: 'Session is cancelled — no reminder sent.' };
  }
  // The cron fires every Fri/Sat/Sun because game day can be any of them; only
  // the one that IS game day should actually send.
  if (session.gameDate !== todayEastern(now)) {
    return { sessionId: session.sessionId, skipped: true, reason: `Game is ${session.gameDate}, not today.` };
  }

  const signups = await listSignupsForSession(session.sessionId);
  const confirmed = signups.filter((s) => s.status === 'confirmed');
  if (confirmed.length === 0) {
    return { sessionId: session.sessionId, skipped: true, reason: 'Nobody is confirmed.' };
  }

  const owed = computeCostShare(session, signups);

  let sent = 0;
  let failed = 0;
  for (const signup of confirmed) {
    try {
      await sendGameDayReminderEmail(signup, session, owed[signup.signupId] ?? 0);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed to send game-day reminder to ${signup.email}:`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
  }

  return { sessionId: session.sessionId, skipped: false, sent, failed };
}
