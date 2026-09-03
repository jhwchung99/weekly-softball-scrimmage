import { upsertPlayer } from '../sheets/players';
import { Signup } from '../sheets/schema';
import { signUpForSession, signUpAsGuestForSession } from './signupFlow';

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
    await upsertPlayer({
      email: input.email,
      fullName: input.profile.fullName,
      gender: input.profile.gender,
      age: input.profile.age,
      savedPositions: input.profile.savedPositions ?? '',
    });
  }

  if (input.invitedByName) {
    return signUpAsGuestForSession(
      input.sessionId,
      input.email,
      input.invitedByName,
      Boolean(input.willingToShare),
      input.waiverAccepted
    );
  }
  return signUpForSession(input.sessionId, input.email, input.waiverAccepted);
}
