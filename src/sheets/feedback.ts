import { SPREADSHEET_ID, appendValues, columnLetter } from './client';
import { Feedback, FEEDBACK_HEADERS, serializeFeedbackRow } from './schema';

const TAB = 'Feedback';

/**
 * Adds one row to the Feedback tab.
 *
 * Append-only by design: there is no getFeedback, because nothing in the
 * app reads this back. The organizer reads the tab directly, which also
 * means a busy week of feedback costs zero read quota, only one write
 * per report.
 *
 * The message is arbitrary player-supplied text, so it depends on
 * appendValues using RAW rather than USER_ENTERED — otherwise a report
 * that happened to start with "=" would land as a live formula.
 */
export async function appendFeedback(feedback: Feedback): Promise<void> {
  const row = serializeFeedbackRow(feedback);
  await appendValues(SPREADSHEET_ID, `${TAB}!A:${columnLetter(FEEDBACK_HEADERS.length)}`, [
    FEEDBACK_HEADERS.map((h) => row[h]),
  ]);
}
