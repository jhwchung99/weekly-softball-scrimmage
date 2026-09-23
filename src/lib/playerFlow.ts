import { upsertPlayer } from '../sheets/players';
import { Player } from '../sheets/schema';
import { withMutationLock } from './lock';

/**
 * Saving a player's own profile.
 *
 * A flow, like every other mutation, so it takes the mutation lock (ADR-0001).
 * The route used to call upsertPlayer directly, and upsertPlayer reads then
 * appends: a double-submitted first save could find no row twice and append
 * two, after which getPlayer only ever saw the first and later edits went to
 * one copy while the other went stale.
 */
export async function savePlayerProfile(player: Player): Promise<void> {
  return withMutationLock(() => upsertPlayer(player));
}
