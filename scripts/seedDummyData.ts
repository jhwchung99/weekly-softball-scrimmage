import { createSession } from '../src/sheets/sessions';
import { upsertPlayer } from '../src/sheets/players';
import { signUpForSession } from '../src/lib/signupFlow';

// Deliberately low capacity so this exercises confirmed vs. waitlisted
// with only a handful of players, plus a duplicate-signup rejection.
const SESSION_ID = '2099-06-05'; // far future, obviously a test row; must be a Friday
const CAPACITY = 3;

const PLAYERS = [
  { email: 'seed-alex@dummy.test', fullName: 'Seed Alex', gender: 'Male', age: 27, savedPositions: 'Catcher, 1B' },
  { email: 'seed-brianna@dummy.test', fullName: 'Seed Brianna', gender: 'Female', age: 29, savedPositions: 'SS, 2B' },
  { email: 'seed-carlos@dummy.test', fullName: 'Seed Carlos', gender: 'Male', age: 31, savedPositions: 'Outfield, Rover' },
  { email: 'seed-dana@dummy.test', fullName: 'Seed Dana', gender: 'Female', age: 24, savedPositions: '3B, SS' },
  { email: 'seed-evan@dummy.test', fullName: 'Seed Evan', gender: 'Male', age: 33, savedPositions: 'Anything' },
];

async function main() {
  const write = process.argv.includes('--write');

  console.log(`${write ? 'Creating' : 'DRY RUN — would create'} session "${SESSION_ID}" (capacity ${CAPACITY}):`);
  console.log(`${write ? 'Creating' : 'DRY RUN — would create'} ${PLAYERS.length} player profiles:`);
  for (const p of PLAYERS) console.log(`  ${p.fullName} <${p.email}> — ${p.savedPositions}`);
  console.log(`${write ? 'Signing up' : 'DRY RUN — would sign up'} players in order (expect first ${CAPACITY} confirmed, rest waitlisted).`);

  if (!write) {
    console.log('\nRe-run with --write to actually create this data.');
    return;
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
