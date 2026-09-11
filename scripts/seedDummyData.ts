import { createSession } from '../src/sheets/sessions';
import { upsertPlayer } from '../src/sheets/players';
import { signUpForSession } from '../src/lib/signupFlow';
import { SPREADSHEET_ID } from '../src/sheets/client';

/**
 * Fills a **scratch** spreadsheet with enough players to exercise confirmed
 * vs. waitlisted and a duplicate rejection.
 *
 * Run it as `npm run seed:dummy` for a dry run. Writing needs the target
 * spelled out:
 *
 *     npm run seed:dummy -- --write --spreadsheet=<the id you mean>
 *
 * and that id must match the SPREADSHEET_ID this process loaded. It is one
 * env var away from the live sheet, and `--write` alone is one flag away from
 * a real roster gaining five people called Seed. Naming the target is the
 * point: you cannot do it by muscle memory.
 *
 * The rows it writes are obvious — `@dummy.test` addresses, a session in
 * 2099 — so a mistake is at least easy to find and undo.
 *
 * Sign-up runs through the real flow, so it will try to send emails. With no
 * Gmail credentials configured those fail and are swallowed, which is what
 * you want here.
 */

// Deliberately low capacity so this exercises confirmed vs. waitlisted
// with only a handful of players, plus a duplicate-signup rejection.
const SESSION_ID = '2099-06-05'; // far future, obviously a test row; must be a Friday
const CAPACITY = 3;

const PLAYERS = [
  { email: 'seed-alex@dummy.test', fullName: 'Seed Alex', gender: 'Male', savedPositions: 'Catcher, 1B' },
  { email: 'seed-brianna@dummy.test', fullName: 'Seed Brianna', gender: 'Female', savedPositions: 'SS, 2B' },
  { email: 'seed-carlos@dummy.test', fullName: 'Seed Carlos', gender: 'Male', savedPositions: 'Outfield, Rover' },
  { email: 'seed-dana@dummy.test', fullName: 'Seed Dana', gender: 'Female', savedPositions: '3B, SS' },
  { email: 'seed-evan@dummy.test', fullName: 'Seed Evan', gender: 'Male', savedPositions: 'Anything' },
] satisfies Parameters<typeof upsertPlayer>[0][];

/**
 * The id the caller said they meant, or null.
 *
 * Passing SPREADSHEET_ID would be no check at all — it is the thing that might
 * be wrong. The caller has to type the id they intend, and it has to match.
 */
function confirmedTarget(): string | null {
  const flag = process.argv.find((a) => a.startsWith('--spreadsheet='));
  return flag ? flag.slice('--spreadsheet='.length) : null;
}

async function main() {
  const write = process.argv.includes('--write');

  console.log(`Target spreadsheet: ${SPREADSHEET_ID}`);
  console.log(`${write ? 'Creating' : 'DRY RUN — would create'} session "${SESSION_ID}" (capacity ${CAPACITY}):`);
  console.log(`${write ? 'Creating' : 'DRY RUN — would create'} ${PLAYERS.length} player profiles:`);
  for (const p of PLAYERS) console.log(`  ${p.fullName} <${p.email}> — ${p.savedPositions}`);
  console.log(`${write ? 'Signing up' : 'DRY RUN — would sign up'} players in order (expect first ${CAPACITY} confirmed, rest waitlisted).`);

  if (!write) {
    console.log(`\nRe-run with: --write --spreadsheet=${SPREADSHEET_ID}`);
    console.log('Check that id is a scratch sheet before you do.');
    return;
  }

  const target = confirmedTarget();
  if (target !== SPREADSHEET_ID) {
    console.error(
      target === null
        ? `\nRefusing to write. Pass --spreadsheet=${SPREADSHEET_ID} to confirm that is the sheet you mean.`
        : `\nRefusing to write. You named ${target}, but this process loaded ${SPREADSHEET_ID}.`
    );
    process.exit(1);
  }

  const [y, m, d] = SESSION_ID.split('-').map(Number);
  await createSession({
    sessionId: SESSION_ID,
    gameDate: SESSION_ID,
    gameTime: '18:00',
    registrationOpensAt: new Date(y, m - 2, d - 4, 9).toISOString(),
    registrationClosesAt: new Date(y, m - 2, d - 1, 21).toISOString(),
    capacity: CAPACITY,
    status: 'open',
    pricePerSpot: 0,
    locationArea: '',
    locationName: '',
    locationUrl: '',
    numFields: 1,
    rosterLockAt: '',
    teamsStatus: '',
    remindersSentAt: '',
    cost: 0,
  });

  for (const player of PLAYERS) {
    await upsertPlayer(player);
  }

  for (const player of PLAYERS) {
    const signup = await signUpForSession(SESSION_ID, player.email, true); // dummy data — waiver moot
    console.log(`${player.fullName}: ${signup.status}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Failed to seed dummy data:', err.message);
  process.exit(1);
});
