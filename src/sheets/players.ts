import { SPREADSHEET_ID, getRowObjects, appendValues, updateRow, columnLetter } from './client';
import { Player, PLAYER_HEADERS, parsePlayerRow, serializePlayerRow } from './schema';
import { normalizeEmail } from '../lib/email';

const TAB = 'Players';

// email is the natural key here — Section 3 lists no separate playerId,
// and identity already comes from Google OAuth login (Section 4). Both sides
// of every match are normalized, so a legacy row stored with different casing
// still resolves to the same person (see lib/email.ts).
export async function getPlayer(email: string): Promise<Player | null> {
  const target = normalizeEmail(email);
  const rows = await getRowObjects<ReturnType<typeof serializePlayerRow>>(SPREADSHEET_ID, TAB, PLAYER_HEADERS);
  const match = rows.find((r) => normalizeEmail(r.data.email) === target);
  return match ? parsePlayerRow(match.data) : null;
}

/** Creates the profile row if this email hasn't signed up before, otherwise
 * updates it in place (e.g. after "update my positions"). */
export async function upsertPlayer(player: Player): Promise<void> {
  const normalized: Player = { ...player, email: normalizeEmail(player.email) };
  const rows = await getRowObjects<ReturnType<typeof serializePlayerRow>>(SPREADSHEET_ID, TAB, PLAYER_HEADERS);
  const match = rows.find((r) => normalizeEmail(r.data.email) === normalized.email);
  const row = serializePlayerRow(normalized);

  if (match) {
    await updateRow(SPREADSHEET_ID, TAB, match.rowNumber, PLAYER_HEADERS, row);
  } else {
    await appendValues(SPREADSHEET_ID, `${TAB}!A:${columnLetter(PLAYER_HEADERS.length)}`, [PLAYER_HEADERS.map((h) => row[h])]);
  }
}
