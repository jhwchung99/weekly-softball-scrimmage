const MALE_BG = { red: 0.80, green: 0.88, blue: 1.0 }; // light blue
const FEMALE_BG = { red: 1.0, green: 0.82, blue: 0.82 }; // light red
const BORDER = { style: 'SOLID', width: 1, color: { red: 0.4, green: 0.4, blue: 0.4 } };

export async function clearConditionalFormats(sheets, spreadsheetId, sheetId) {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties.sheetId,conditionalFormats)',
  });
  const sheet = data.sheets.find((s) => s.properties.sheetId === sheetId);
  const count = sheet?.conditionalFormats?.length || 0;
  if (count === 0) return;

  const requests = Array.from({ length: count }, (_, i) => count - 1 - i).map((index) => ({
    deleteConditionalFormatRule: { sheetId, index },
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// rowRange/colRange are { start, end } 0-indexed, end exclusive (Sheets GridRange convention).
export function mergeAndCenter(sheetId, rowRange, colRange) {
  const range = {
    sheetId,
    startRowIndex: rowRange.start,
    endRowIndex: rowRange.end,
    startColumnIndex: colRange.start,
    endColumnIndex: colRange.end,
  };
  return [
    { mergeCells: { range, mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range,
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
        fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat.bold',
      },
    },
  ];
}

export function boldRow(sheetId, rowIndex, colRange) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: colRange.start,
        endColumnIndex: colRange.end,
      },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  };
}

export function tableBorder(sheetId, rowRange, colRange) {
  return {
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: rowRange.start,
        endRowIndex: rowRange.end,
        startColumnIndex: colRange.start,
        endColumnIndex: colRange.end,
      },
      top: BORDER,
      bottom: BORDER,
      left: BORDER,
      right: BORDER,
      innerHorizontal: BORDER,
      innerVertical: BORDER,
    },
  };
}

// genderColLetter/dataStartRow1Indexed: the column holding Gender and the
// first 1-indexed row of data, so the custom formula anchors correctly.
export function genderConditionalRules(sheetId, dataRowRange, colRange, genderColLetter, dataStartRow1Indexed) {
  const range = {
    sheetId,
    startRowIndex: dataRowRange.start,
    endRowIndex: dataRowRange.end,
    startColumnIndex: colRange.start,
    endColumnIndex: colRange.end,
  };
  const rule = (value, background) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [range],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: `=$${genderColLetter}${dataStartRow1Indexed}="${value}"` }],
          },
          format: { backgroundColor: background },
        },
      },
      index: 0,
    },
  });
  return [rule('Male', MALE_BG), rule('Female', FEMALE_BG)];
}

export function autoResizeColumns(sheetId, endColumnIndex = 7) {
  return {
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: endColumnIndex },
    },
  };
}

export async function applyFormatting(sheets, spreadsheetId, sheetId, requests) {
  await clearConditionalFormats(sheets, spreadsheetId, sheetId);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}
