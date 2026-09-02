import { getValues, getOrCreateSheet, getSheetsClient, appendValues } from '../src/sheets/client.js';
import { findPossibleDuplicates } from '../src/sheets/similarity.js';
import { applyFormatting, boldRow, tableBorder, autoResizeColumns } from '../src/sheets/format.js';
import { MIN_FOR_ANYTHING } from '../src/sheets/thresholds.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

const RESPONSES_TAB = 'Responses';
const ALIASES_TAB = 'Name Aliases';
const HISTORY_TAB = 'Attendance History';

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The Friday that "owns" a given timestamp's Mon-Sun week.
function fridayOfWeek(date) {
  const dayIdx = (date.getDay() + 6) % 7; // 0=Mon..6=Sun
  const monday = new Date(date);
  monday.setDate(monday.getDate() - dayIdx);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  return friday;
}

function parseResponses(rawRows) {
  const [, ...rows] = rawRows;
  return rows
    .filter((r) => r && r[0] && r[1])
    .map((r) => ({ timestamp: new Date(r[0]), name: r[1].trim() }));
}

async function loadAliasMap(spreadsheetId) {
  const tab = await getOrCreateSheet(spreadsheetId, ALIASES_TAB);
  const values = await getValues(spreadsheetId, `${ALIASES_TAB}!A2:B`);
  if (values.length === 0) {
    // Seed headers so the tab is immediately usable in the Sheets UI.
    await appendValues(spreadsheetId, `${ALIASES_TAB}!A1`, [['Alias', 'Canonical Name']]);
  }
  const map = new Map();
  for (const [alias, canonical] of values) {
    if (alias && canonical) map.set(alias.trim().toLowerCase(), canonical.trim());
  }
  return { tab, map };
}

async function main() {
  const [rawResponses, { map: aliasMap }] = await Promise.all([
    getValues(SPREADSHEET_ID, `${RESPONSES_TAB}!A:G`),
    loadAliasMap(SPREADSHEET_ID),
  ]);

  const records = parseResponses(rawResponses).map((r) => ({
    ...r,
    name: aliasMap.get(r.name.toLowerCase()) || r.name,
  }));

  // Bucket by week (Friday label), count unique attendees per week, and
  // drop weeks that didn't meet the minimum-to-happen threshold.
  const byWeek = new Map();
  for (const r of records) {
    const friday = toISODate(fridayOfWeek(r.timestamp));
    if (!byWeek.has(friday)) byWeek.set(friday, new Set());
    byWeek.get(friday).add(r.name);
  }

  const qualifyingWeeks = [...byWeek.entries()]
    .filter(([, names]) => names.size >= MIN_FOR_ANYTHING)
    .sort(([a], [b]) => a.localeCompare(b));

  console.log(`${byWeek.size} week(s) found in Responses, ${qualifyingWeeks.length} met the ${MIN_FOR_ANYTHING}+ turnout minimum.\n`);

  const stats = new Map(); // name -> { count, first, last }
  for (const [friday, names] of qualifyingWeeks) {
    for (const name of names) {
      const s = stats.get(name) || { count: 0, first: friday, last: friday };
      s.count += 1;
      s.last = friday;
      stats.set(name, s);
    }
  }

  const allNames = [...stats.keys()].sort((a, b) => a.localeCompare(b));
  const duplicates = findPossibleDuplicates(allNames);

  if (duplicates.length > 0) {
    console.log(`${duplicates.length} possible duplicate name pair(s) found — not merged automatically:`);
    for (const { a, b, distance } of duplicates) {
      console.log(`  "${a}" (${stats.get(a).count}) vs "${b}" (${stats.get(b).count}) — edit distance ${distance}`);
    }
    console.log(`\nIf any of these are the same person, add a row to the "${ALIASES_TAB}" tab (Alias -> Canonical Name) and re-run.\n`);
  } else {
    console.log('No possible duplicate names found.\n');
  }

  const ranked = [...stats.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  const tab = await getOrCreateSheet(SPREADSHEET_ID, HISTORY_TAB);

  const rows = [
    [`Attendance History — as of ${toISODate(new Date())} (${qualifyingWeeks.length} qualifying week(s))`],
    [],
    ['Full Name', 'Weeks Attended', 'First Week', 'Last Week'],
    ...ranked.map(([name, s]) => [name, s.count, s.first, s.last]),
  ];

  const requests = [
    boldRow(tab.sheetId, 2, { start: 0, end: 4 }),
    tableBorder(tab.sheetId, { start: 2, end: 3 + ranked.length }, { start: 0, end: 4 }),
  ];

  if (duplicates.length > 0) {
    const dupStartRow = rows.length + 1;
    rows.push([]);
    rows.push([`Possible Duplicates — review, then add confirmed matches to "${ALIASES_TAB}"`]);
    rows.push(['Name A', 'Weeks (A)', 'Name B', 'Weeks (B)', 'Edit Distance']);
    for (const { a, b, distance } of duplicates) {
      rows.push([a, stats.get(a).count, b, stats.get(b).count, distance]);
    }
    requests.push(
      boldRow(tab.sheetId, dupStartRow + 1, { start: 0, end: 5 }),
      tableBorder(tab.sheetId, { start: dupStartRow + 1, end: dupStartRow + 2 + duplicates.length }, { start: 0, end: 5 })
    );
  }

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: HISTORY_TAB });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${HISTORY_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  await applyFormatting(sheets, SPREADSHEET_ID, tab.sheetId, [...requests, autoResizeColumns(tab.sheetId, 5)]);

  console.log(`Written to tab "${HISTORY_TAB}":`);
  console.log(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${tab.sheetId}`);
}

main().catch((err) => {
  console.error('Failed to generate attendance history:', err.message);
  process.exit(1);
});
