import { getSheetsClient, getSpreadsheetMeta } from '../src/sheets/client.js';
import { POSITIONS } from '../src/sheets/positions.js';

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1n4Hi_p_o9BtkMdracVUE6eAzAgfyIFXn1w31MCiuqJk';

const TAB_NAME = 'Positions';

const HEADERS = [
  'Last Updated',
  'Name',
  'Gender',
  ...POSITIONS,
  'Latest Position Timestamp',
  'Latest Position Raw',
];

const MAX_ROW = 1000; // generous cap on unique respondents

function positionFormula(position, rawCol) {
  return `=MAP(B2:B${MAX_ROW},${rawCol}2:${rawCol}${MAX_ROW},LAMBDA(name,raw,IF(name="","",REGEXMATCH(raw,"(^|, )(${position}|Anything)(,|$)"))))`;
}

// MAP+LAMBDA iterates row-by-row explicitly, unlike MAXIFS/VLOOKUP wrapped in
// ARRAYFORMULA, which do NOT reliably vectorize a criteria argument built from
// a spilled array — empirically they collapsed to a single scalar (row 2's
// value) and got broadcast to every row instead of computing per-row.
const ROW2_FORMULAS = [
  // A: Last Updated — most recent submission overall for this name
  `=MAP(B2:B${MAX_ROW},LAMBDA(name,IF(name="","",MAXIFS(Responses!$A$2:$A,Responses!$B$2:$B,name))))`,
  // B: Name
  `=SORT(UNIQUE(FILTER(Responses!B2:B,Responses!B2:B<>"")))`,
  // C: Gender — from that same most-recent row
  `=MAP(B2:B${MAX_ROW},LAMBDA(name,IF(name="","",IFERROR(INDEX(FILTER(Responses!$C$2:$C,Responses!$B$2:$B=name,Responses!$A$2:$A=MAXIFS(Responses!$A$2:$A,Responses!$B$2:$B,name)),1),""))))`,
  // D-J: one per position, referencing L (raw positions text)
  ...POSITIONS.map((p) => positionFormula(p, 'L')),
  // K: Latest Position Timestamp (helper) — most recent submission where positions was NOT left blank
  `=MAP(B2:B${MAX_ROW},LAMBDA(name,IF(name="","",IF(MAXIFS(Responses!$A$2:$A,Responses!$B$2:$B,name,Responses!$G$2:$G,"<>")=0,"",MAXIFS(Responses!$A$2:$A,Responses!$B$2:$B,name,Responses!$G$2:$G,"<>")))))`,
  // L: Latest Position Raw (helper) — the positions text from that row
  `=MAP(B2:B${MAX_ROW},LAMBDA(name,IF(name="","",IFERROR(INDEX(FILTER(Responses!$G$2:$G,Responses!$B$2:$B=name,Responses!$A$2:$A=MAXIFS(Responses!$A$2:$A,Responses!$B$2:$B,name,Responses!$G$2:$G,"<>")),1),""))))`,
];

async function main() {
  const sheets = await getSheetsClient();
  const tabs = await getSpreadsheetMeta(SPREADSHEET_ID);

  let tab = tabs.find((t) => t.title === TAB_NAME);

  if (!tab) {
    console.log(`Creating "${TAB_NAME}" tab...`);
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: TAB_NAME },
            },
          },
        ],
      },
    });
    const props = res.data.replies[0].addSheet.properties;
    tab = { title: props.title, sheetId: props.sheetId };
  } else {
    console.log(`"${TAB_NAME}" tab already exists (sheetId ${tab.sheetId}) — reusing it.`);
  }

  console.log('Writing header row...');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });

  console.log('Writing row 2 formulas...');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB_NAME}!A2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [ROW2_FORMULAS] },
  });

  const positionStartCol = 3; // D, 0-indexed
  const positionEndCol = positionStartCol + POSITIONS.length; // exclusive, J+1

  console.log('Applying checkbox validation and formatting...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: tab.sheetId,
              startRowIndex: 1,
              endRowIndex: MAX_ROW,
              startColumnIndex: positionStartCol,
              endColumnIndex: positionEndCol,
            },
            rule: {
              condition: { type: 'BOOLEAN' },
              strict: false,
              showCustomUi: true,
            },
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: tab.sheetId,
              startRowIndex: 1,
              endRowIndex: MAX_ROW,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'DATE_TIME', pattern: 'M/d/yyyy H:mm:ss' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: tab.sheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });

  console.log(`\nDone. "${TAB_NAME}" tab is set up at:`);
  console.log(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${tab.sheetId}`);
}

main().catch((err) => {
  console.error('Failed to create Positions sheet:', err.message);
  process.exit(1);
});
