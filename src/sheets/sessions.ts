import { SPREADSHEET_ID, getRowObjects, appendValues, updateRow, columnLetter } from './client';
import { Session, SessionStatus, SESSION_HEADERS, parseSessionRow, serializeSessionRow } from './schema';

const TAB = 'Sessions';

export async function listSessions(): Promise<Session[]> {
  const rows = await getRowObjects<ReturnType<typeof serializeSessionRow>>(SPREADSHEET_ID, TAB, SESSION_HEADERS);
  return rows.map((r) => parseSessionRow(r.data));
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const sessions = await listSessions();
  return sessions.find((s) => s.sessionId === sessionId) ?? null;
}

/**
 * Whichever of the given ids has a session row, checked in order, from a
 * single tab read — for "does this week's game exist under any of
 * Friday/Saturday/Sunday" (see time.ts's currentWeekGameDayCandidates)
 * without paying for a separate read per candidate.
 */
export async function getSessionByAnyId(sessionIds: string[]): Promise<Session | null> {
  const sessions = await listSessions();
  for (const id of sessionIds) {
    const match = sessions.find((s) => s.sessionId === id);
    if (match) return match;
  }
  return null;
}

/**
 * sessionId is the row-identity strategy for this tab: one scrimmage per
 * calendar date, so the ISO date (e.g. "2026-09-11") doubles as a
 * naturally-unique id — no separate id generator needed. Rejects a
 * duplicate sessionId outright, since Sheets itself enforces nothing.
 */
export async function createSession(session: Session): Promise<Session> {
  const existing = await getSession(session.sessionId);
  if (existing) {
    throw new Error(`A session with id "${session.sessionId}" already exists.`);
  }
  const row = serializeSessionRow(session);
  await appendValues(SPREADSHEET_ID, `${TAB}!A:${columnLetter(SESSION_HEADERS.length)}`, [SESSION_HEADERS.map((h) => row[h])]);
  return session;
}

/** Partial update of any field(s) on an existing session row. */
export async function updateSession(sessionId: string, updates: Partial<Session>): Promise<Session> {
  const rows = await getRowObjects<ReturnType<typeof serializeSessionRow>>(SPREADSHEET_ID, TAB, SESSION_HEADERS);
  const match = rows.find((r) => r.data.sessionId === sessionId);
  if (!match) throw new Error(`No session with id "${sessionId}".`);

  const updated: Session = { ...parseSessionRow(match.data), ...updates };
  await updateRow(SPREADSHEET_ID, TAB, match.rowNumber, SESSION_HEADERS, serializeSessionRow(updated));
  return updated;
}

export async function updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
  await updateSession(sessionId, { status });
}
