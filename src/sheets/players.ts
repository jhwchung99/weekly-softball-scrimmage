import { SPREADSHEET_ID, getRowObjects, appendValues, updateRow, columnLetter } from './client';
import { Player, PLAYER_HEADERS, parsePlayerRow, serializePlayerRow } from './schema';

const TAB = 'Players';

// email is the natural key here — Section 3 lists no separate playerId,
// and identity already comes from Google OAuth login (Section 4).
export async function getPlayer(email: string): Promise<Player | null> {
  const rows = await getRowObjects<ReturnType<typeof serializePlayerRow>>(SPREADSHEET_ID, TAB, PLAYER_HEADERS);
  const match = rows.find((r) => r.data.email === email);
  return match ? parsePlayerRow(match.data) : null;
}

/** Creates the profile row if this email hasn't signed up before, otherwise
 * updates it in place (e.g. after "update my positions"). */
export async function upsertPlayer(player: Player): Promise<void> {
  const rows = await getRowObjects<ReturnType<typeof serializePlayerRow>>(SPREADSHEET_ID, TAB, PLAYER_HEADERS);
  const match = rows.find((r) => r.data.email === player.email);
  const row = serializePlayerRow(player);

  if (match) {
    await updateRow(SPREADSHEET_ID, TAB, match.rowNumber, PLAYER_HEADERS, row);
  } else {
    await appendValues(SPREADSHEET_ID, `${TAB}!A:${columnLetter(PLAYER_HEADERS.length)}`, [PLAYER_HEADERS.map((h) => row[h])]);
  }
}
