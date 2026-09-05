import { upsertPlayer } from '../sheets/players';
import { getSession, createSession, updateSession } from '../sheets/sessions';
import { listSignupsForSession, batchUpdateSignups } from '../sheets/signups';
import { Session, Signup } from '../sheets/schema';
import { signUpForSession, signUpAsGuestForSession } from './signupFlow';
import { DEFAULT_GAME_TIME, DEFAULT_CAPACITY } from './scheduling';
import { ApiError } from './apiErrors';
import {
  validatePlayerProfile,
  validateInvitedByName,
  validateGameDate,
  validateGameTime,
  validateCapacity,
  validateCost,
} from './validation';

export interface AdminAddSignupInput {
  sessionId: string;
  email: string;
  /** Only needed if this player has never signed up before (no Players row yet). */
  profile?: { fullName: string; gender: string; age: number; savedPositions?: string };
  /** Presence of invitedByName routes through the guest path, same as the player-facing route. */
  invitedByName?: string;
  willingToShare?: boolean;
  /** Required (Section 9) even for admin-added rows — the admin is
   * confirming this person consented, keeping the audit trail consistent
   * across every signup path rather than carving out a silent exception. */
  waiverAccepted: boolean;
}

/**
 * "Manually add a signup" (Section 8) — an organizer adding someone who
 * contacted them directly rather than using the app. Deliberately reuses
 * the same signUpForSession/signUpAsGuestForSession functions a player
 * would go through themselves, rather than a separate bypass path: this
 * keeps capacity accounting and duplicate-prevention intact even for
 * admin-added rows. The one thing this adds is the optional inline
 * profile upsert, so a first-time player can be added without already
 * having a Players row (which self-signup would reject as
 * PROFILE_REQUIRED).
 *
 * Judgment call, not spelled out in the guidelines: this does NOT bypass
 * the "session must be open" check, so an admin can't add someone to a
 * closed/cancelled/rained-out session. If that turns out to be wanted,
 * it's a small change here — flagging rather than assuming either way.
 */
export async function adminAddSignup(input: AdminAddSignupInput): Promise<Signup> {
  if (input.profile) {
    const profile = validatePlayerProfile(input.profile);
    await upsertPlayer({ email: input.email, ...profile });
  }

  if (input.invitedByName) {
    return signUpAsGuestForSession(
      input.sessionId,
      input.email,
      validateInvitedByName(input.invitedByName),
      Boolean(input.willingToShare),
      input.waiverAccepted
    );
  }
  return signUpForSession(input.sessionId, input.email, input.waiverAccepted);
}

export interface AdminCreateSessionInput {
  gameDate: unknown;
  gameTime?: unknown;
  capacity?: unknown;
  cost?: unknown;
}

/**
 * "Create a session" (Section 8) — sessionId doubles as gameDate (see
 * sheets/sessions.ts), so this is really just createSession with
 * defaults filled in and gameDate/gameTime validated. Mainly for
 * scheduling a Saturday/Sunday game, or a Friday one ahead of the
 * Monday-open cron so an admin can set a non-default capacity/cost from
 * the start rather than editing it in right after.
 */
export async function adminCreateSession(input: AdminCreateSessionInput): Promise<Session> {
  const gameDate = validateGameDate(input.gameDate);
  const gameTime = input.gameTime !== undefined ? validateGameTime(input.gameTime) : DEFAULT_GAME_TIME;
  const capacity = input.capacity !== undefined ? validateCapacity(input.capacity) : DEFAULT_CAPACITY;
  const cost = input.cost !== undefined ? validateCost(input.cost) : 0;

  const existing = await getSession(gameDate);
  if (existing) throw new ApiError(409, `A session for ${gameDate} already exists.`);

  return createSession({
    sessionId: gameDate,
    gameDate,
    gameTime,
    registrationOpensAt: '',
    registrationClosesAt: '',
    capacity,
    cost,
    status: 'open',
  });
}

/**
 * Moving a session to a new date changes its identity — sessionId
 * *is* gameDate, the lookup key the homepage and the weekly cron jobs
 * use to find "this week's session" (see time.ts's
 * currentWeekGameDayCandidates). Renaming the existing row in place
 * (rather than create-new + delete-old) keeps this to one session-row
 * write; every signup referencing the old sessionId is then repointed
 * at the new one in the same pass so nothing orphans. Best-effort, not
 * a real transaction — Sheets has no cross-tab atomicity, same
 * trade-off already accepted throughout this codebase.
 */
export async function adminRescheduleSession(sessionId: string, newGameDate: unknown, newGameTime: unknown): Promise<Session> {
  const gameDate = validateGameDate(newGameDate);
  const gameTime = validateGameTime(newGameTime);

  const existing = await getSession(sessionId);
  if (!existing) throw new ApiError(404, 'No such session.');

  if (gameDate === sessionId) {
    // Same identity — a pure time change (or a no-op date), no rekey needed.
    return updateSession(sessionId, { gameDate, gameTime });
  }

  const conflict = await getSession(gameDate);
  if (conflict) throw new ApiError(409, `A session for ${gameDate} already exists.`);

  const updated = await updateSession(sessionId, { sessionId: gameDate, gameDate, gameTime });

  const signups = await listSignupsForSession(sessionId);
  if (signups.length > 0) {
    await batchUpdateSignups(signups.map((s) => ({ signupId: s.signupId, updates: { sessionId: gameDate } })));
  }

  return updated;
}
