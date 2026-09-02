import { getValues, getOrCreateSheet, getSheetsClient } from '../src/sheets/client.js';
import { POSITIONS } from '../src/sheets/positions.js';
import {
  applyFormatting,
  mergeAndCenter,
  boldRow,
  tableBorder,
  genderConditionalRules,
  autoResizeColumns,
} from '../src/sheets/format.js';
import { MIN_FOR_ANYTHING, MIN_FOR_SCRIMMAGE, MIN_FOR_FULL_SCRIMMAGE } from '../src/sheets/thresholds.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

const RESPONSES_TAB = 'Responses';

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Friday of the current week, or today if today already is Friday.
function nextFriday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const diff = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function parseTargetDate(arg) {
  if (!arg) return nextFriday();
  const [y, m, day] = arg.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  if (d.getDay() !== 5) {
    throw new Error(`${arg} is not a Friday (got day-of-week ${d.getDay()}).`);
  }
  return d;
}

function weekWindow(friday) {
  const start = new Date(friday);
  start.setDate(start.getDate() - 4); // Monday
  start.setHours(0, 0, 0, 0);
  const end = new Date(friday);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function parseResponses(rawRows) {
  const [, ...rows] = rawRows; // drop header
  return rows
    .filter((r) => r && r[0] && r[1])
    .map((r) => ({
      timestamp: new Date(r[0]),
      name: r[1].trim(),
      gender: (r[2] || '').trim(),
      positionsRaw: (r[6] || '').trim(),
    }));
}

function expandPositions(raw) {
  if (!raw) return [];
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.some((t) => t.toLowerCase() === 'anything')) return [...POSITIONS];
  return tokens;
}

function buildRoster(records, weekStart, weekEnd) {
  const upToWeek = records.filter((r) => r.timestamp <= weekEnd);
  const thisWeekNames = new Set(
    upToWeek
      .filter((r) => r.timestamp >= weekStart && r.timestamp <= weekEnd)
      .map((r) => r.name)
  );

  const byName = new Map();
  for (const r of upToWeek) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }

  const roster = [];
  for (const name of thisWeekNames) {
    const history = byName.get(name).sort((a, b) => a.timestamp - b.timestamp);
    const latestGender = [...history].reverse().find((r) => r.gender)?.gender || 'Unknown';
    const latestPositionsRow = [...history].reverse().find((r) => r.positionsRaw);
    const positions = latestPositionsRow ? expandPositions(latestPositionsRow.positionsRaw) : [];
    roster.push({ name, gender: latestGender, positions });
  }
  return roster;
}

function splitTeams(roster) {
  const byGender = new Map();
  for (const p of roster) {
    if (!byGender.has(p.gender)) byGender.set(p.gender, []);
    byGender.get(p.gender).push(p);
  }

  const teamA = [];
  const teamB = [];
  for (const group of byGender.values()) {
    group.sort((a, b) => b.positions.length - a.positions.length || a.name.localeCompare(b.name));
    group.forEach((player, i) => (i % 2 === 0 ? teamA : teamB).push(player));
  }
  return { teamA, teamB };
}

// Single greedy pass over `positions`: if one has zero coverage on a team
// while the other has 2+, swap one same-gender player to even it out.
// Heuristic, not an optimal solver — good enough for roster balancing.
function balancePositionCoverage(teamA, teamB, positions) {
  for (const pos of positions) {
    const countA = teamA.filter((p) => p.positions.includes(pos)).length;
    const countB = teamB.filter((p) => p.positions.includes(pos)).length;

    const [empty, full] =
      countA === 0 && countB >= 2 ? [teamA, teamB] : countB === 0 && countA >= 2 ? [teamB, teamA] : [null, null];
    if (!empty) continue;

    const candidate = full.find((p) => p.positions.includes(pos));
    if (!candidate) continue;
    const partnerIdx = empty.findIndex((p) => p.gender === candidate.gender);
    if (partnerIdx === -1) continue;

    const partner = empty[partnerIdx];
    empty.splice(partnerIdx, 1, candidate);
    full.splice(full.indexOf(candidate), 1, partner);
  }
}

function summarize(team) {
  const male = team.filter((p) => p.gender === 'Male').length;
  const female = team.filter((p) => p.gender === 'Female').length;
  const other = team.length - male - female;
  const parts = [`${male}M`, `${female}F`];
  if (other) parts.push(`${other} other`);
  return `${team.length} players — ${parts.join(' / ')}`;
}

// A single-column-block roster listing (title row + header row + one row
// per player). Returns the grid rows to write, the formatting requests for
// this block, and the next free row index for whatever comes after it.
function singleListSection(rowCursor, sheetId, titleText, players) {
  const titleRow = rowCursor;
  const headerRow = rowCursor + 1;
  const dataStart = rowCursor + 2;
  const dataEnd = dataStart + players.length;

  const rows = [
    [titleText],
    ['Full Name', 'Gender', 'Positions'],
    ...players.map((p) => [p.name, p.gender, p.positions.join(', ')]),
  ];

  const requests = [
    ...mergeAndCenter(sheetId, { start: titleRow, end: titleRow + 1 }, { start: 0, end: 3 }),
    boldRow(sheetId, headerRow, { start: 0, end: 3 }),
    tableBorder(sheetId, { start: headerRow, end: dataEnd }, { start: 0, end: 3 }),
    ...genderConditionalRules(sheetId, { start: dataStart, end: dataEnd }, { start: 0, end: 3 }, 'B', dataStart + 1),
  ];

  return { rows, requests, nextRow: dataEnd };
}

// Two side-by-side team columns. `sectionTitle` is optional — omit it to
// match the original single-section layout used when turnout is high enough
// for a normal scrimmage (no separate "Option B" banner needed).
function twoTeamSection(rowCursor, sheetId, teamA, teamB, sectionTitle) {
  let r = rowCursor;
  const rows = [];
  const requests = [];

  if (sectionTitle) {
    rows.push([sectionTitle]);
    requests.push(...mergeAndCenter(sheetId, { start: r, end: r + 1 }, { start: 0, end: 7 }));
    r += 1;
  }

  const teamHeaderRow = r;
  r += 1;
  const columnHeaderRow = r;
  r += 1;
  const dataStart = r;
  const maxLen = Math.max(teamA.length, teamB.length);
  const dataEnd = dataStart + maxLen;

  rows.push([`Team A (${summarize(teamA)})`, '', '', '', `Team B (${summarize(teamB)})`]);
  rows.push(['Full Name', 'Gender', 'Positions', '', 'Full Name', 'Gender', 'Positions']);
  for (let i = 0; i < maxLen; i++) {
    const a = teamA[i];
    const b = teamB[i];
    rows.push([a?.name || '', a?.gender || '', a?.positions.join(', ') || '', '', b?.name || '', b?.gender || '', b?.positions.join(', ') || '']);
  }

  requests.push(
    ...mergeAndCenter(sheetId, { start: teamHeaderRow, end: teamHeaderRow + 1 }, { start: 0, end: 3 }),
    ...mergeAndCenter(sheetId, { start: teamHeaderRow, end: teamHeaderRow + 1 }, { start: 4, end: 7 }),
    boldRow(sheetId, columnHeaderRow, { start: 0, end: 7 }),
    tableBorder(sheetId, { start: columnHeaderRow, end: dataEnd }, { start: 0, end: 3 }),
    tableBorder(sheetId, { start: columnHeaderRow, end: dataEnd }, { start: 4, end: 7 }),
    ...genderConditionalRules(sheetId, { start: dataStart, end: dataEnd }, { start: 0, end: 3 }, 'B', dataStart + 1),
    ...genderConditionalRules(sheetId, { start: dataStart, end: dataEnd }, { start: 4, end: 7 }, 'F', dataStart + 1)
  );

  return { rows, requests, nextRow: dataEnd };
}

function resetSheetRequest(sheetId) {
  const bigRange = { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 20 };
  return [
    { unmergeCells: { range: bigRange } },
    { repeatCell: { range: bigRange, cell: {}, fields: 'userEnteredFormat' } },
  ];
}

async function main() {
  const targetDate = parseTargetDate(process.argv[2]);
  const { start, end } = weekWindow(targetDate);
  const tabName = toISODate(targetDate);

  console.log(`Target scrimmage date: ${tabName}`);
  console.log(`RSVP window: ${start.toLocaleString()} to ${end.toLocaleString()}\n`);

  const rawRows = await getValues(SPREADSHEET_ID, `${RESPONSES_TAB}!A:G`);
  const records = parseResponses(rawRows);
  const roster = buildRoster(records, start, end).sort((a, b) => a.name.localeCompare(b.name));
  const total = roster.length;

  console.log(`RSVPs this week: ${total}`);

  const sheets = await getSheetsClient();
  const tab = await getOrCreateSheet(SPREADSHEET_ID, tabName);
  const resetRequests = resetSheetRequest(tab.sheetId);

  let rows;
  let requests;

  if (total < MIN_FOR_ANYTHING) {
    console.log(`Below ${MIN_FOR_ANYTHING} — cancelling this week.\n`);
    const banner = [`Scrimmage ${tabName} — Cancelled: only ${total} RSVP'd (need at least ${MIN_FOR_ANYTHING})`];
    const section = singleListSection(2, tab.sheetId, `RSVPs (${total})`, roster);
    rows = [banner, [], ...section.rows];
    requests = [...resetRequests, ...section.requests];
  } else if (total < MIN_FOR_SCRIMMAGE) {
    console.log(`Between ${MIN_FOR_ANYTHING} and ${MIN_FOR_SCRIMMAGE - 1} — not enough for a scrim, practice only.\n`);
    const banner = [`Scrimmage ${tabName} — Practice only (${total} players, need ${MIN_FOR_SCRIMMAGE} for a scrim)`];
    const section = singleListSection(2, tab.sheetId, `Practice Roster (${total} players)`, roster);
    rows = [banner, [], ...section.rows];
    requests = [...resetRequests, ...section.requests];
  } else if (total <= MIN_FOR_FULL_SCRIMMAGE - 1) {
    console.log(`Between ${MIN_FOR_SCRIMMAGE} and ${MIN_FOR_FULL_SCRIMMAGE - 1} — generating Practice + no-Rover scrimmage options.\n`);
    const banner = [`Scrimmage ${tabName} — Low turnout (${total} players): choose Practice or Scrimmage (No Rover)`];

    const practice = singleListSection(2, tab.sheetId, `Option A: Practice Roster (${total} players)`, roster);

    const { teamA, teamB } = splitTeams(roster);
    balancePositionCoverage(teamA, teamB, POSITIONS.filter((p) => p !== 'Rover'));
    teamA.sort((a, b) => a.name.localeCompare(b.name));
    teamB.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`  Option B Team A: ${summarize(teamA)}`);
    console.log(`  Option B Team B: ${summarize(teamB)}\n`);
    const scrim = twoTeamSection(practice.nextRow + 1, tab.sheetId, teamA, teamB, 'Option B: Scrimmage Teams (No Rover)');

    rows = [banner, [], ...practice.rows, [], ...scrim.rows];
    requests = [...resetRequests, ...practice.requests, ...scrim.requests];
  } else {
    console.log(`${MIN_FOR_FULL_SCRIMMAGE}+ — generating a full two-team scrimmage.\n`);
    const { teamA, teamB } = splitTeams(roster);
    balancePositionCoverage(teamA, teamB, POSITIONS);
    teamA.sort((a, b) => a.name.localeCompare(b.name));
    teamB.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`Team A: ${summarize(teamA)}`);
    console.log(`Team B: ${summarize(teamB)}\n`);

    const banner = [`Scrimmage ${tabName} — RSVPs ${toISODate(start)} to ${toISODate(end)}`];
    const section = twoTeamSection(2, tab.sheetId, teamA, teamB);
    rows = [banner, [], ...section.rows];
    requests = [...resetRequests, ...section.requests];
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: tabName });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log('Applying formatting (merges, borders, gender colors, autowidth)...');
  await applyFormatting(sheets, SPREADSHEET_ID, tab.sheetId, [...requests, autoResizeColumns(tab.sheetId)]);

  console.log(`\nWritten to tab "${tabName}":`);
  console.log(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${tab.sheetId}`);
}

main().catch((err) => {
  console.error('Failed to generate scrimmage teams:', err.message);
  process.exit(1);
});
