import { describe, it, expect } from 'vitest';
import {
  adminRequestFor,
  adminFailureMessage,
  type AdminAction,
  classifyLoadFailure,
  sessionIdAfterRevision,
  splitAcrossRoster,
  announcementNotice,
  sessionInputsFor,
} from '../adminConsole';
import type { AdminRosterEntry, AdminSessionView } from '../views';

/**
 * The console's state machine used to have no test surface at all — around
 * eight hundred of the page's lines were unreachable, and that is where the
 * last roster bug was fixed. These are the parts that decide something.
 */

const entry = (over: Partial<AdminRosterEntry> = {}): AdminRosterEntry => ({
  signupId: 's1',
  email: 'a@dummy.test',
  fullName: 'A',
  memberStatus: 'member',
  invitedByName: '',
  pairId: '',
  status: 'confirmed',
  positions: '',
  paid: false,
  amountPaid: 0,
  attended: false,
  ...over,
});

describe('classifyLoadFailure', () => {
  it('shows the not-an-admin screen for a rejected caller', () => {
    expect(classifyLoadFailure({ status: 403, message: 'nope' }, '2099-01-01')).toEqual({
      forbidden: true,
      error: null,
    });
  });

  it('treats an expired session the same way, since signing in again is the fix', () => {
    expect(classifyLoadFailure({ status: 401, message: 'nope' }, '2099-01-01').forbidden).toBe(true);
  });

  it('says a session does not exist yet, naming the one that was asked for', () => {
    // Normal on a Monday morning, so it reads as a state rather than a fault.
    expect(classifyLoadFailure({ status: 404, message: 'Not found' }, '2099-06-06')).toEqual({
      forbidden: false,
      error: 'No session "2099-06-06" exists yet.',
    });
  });

  it('shows any other failure verbatim, rather than swallowing it', () => {
    expect(classifyLoadFailure({ status: 500, message: 'Sheets API is down' }, '2099-01-01')).toEqual({
      forbidden: false,
      error: 'Sheets API is down',
    });
  });

  it('handles a failure that carries no status at all', () => {
    expect(classifyLoadFailure({ message: 'Network error' }, '2099-01-01')).toEqual({
      forbidden: false,
      error: 'Network error',
    });
  });
});

describe('sessionIdAfterRevision', () => {
  it('follows a rescheduled session to its new id', () => {
    // A session's id is its game date, so moving the game rekeys the row. Not
    // following it leaves the next edit landing on a session that is gone.
    expect(sessionIdAfterRevision('2026-07-10', { sessionId: '2026-07-11' })).toBe('2026-07-11');
  });

  it('stays put when the edit did not move the game', () => {
    expect(sessionIdAfterRevision('2026-07-10', { sessionId: '2026-07-10' })).toBe('2026-07-10');
  });

  it('stays put rather than stranding the console when the response names no session', () => {
    expect(sessionIdAfterRevision('2026-07-10', undefined)).toBe('2026-07-10');
    expect(sessionIdAfterRevision('2026-07-10', null)).toBe('2026-07-10');
    expect(sessionIdAfterRevision('2026-07-10', {})).toBe('2026-07-10');
  });
});

describe('splitAcrossRoster', () => {
  it('divides the permit cost by confirmed spots', () => {
    const roster = [entry({ signupId: 'a' }), entry({ signupId: 'b' }), entry({ signupId: 'c' })];

    expect(splitAcrossRoster('120', roster)).toMatchObject({ spots: 3, total: 120, each: 40, canSplit: true });
  });

  it('counts a shared spot once, so the roster is not under-collected', () => {
    // Two people sharing pay one spot's price between them. Dividing by heads
    // would under-collect by exactly the number of shared spots.
    const roster = [
      entry({ signupId: 'a', pairId: 'p1' }),
      entry({ signupId: 'b', pairId: 'p1' }),
      entry({ signupId: 'c' }),
    ];

    expect(splitAcrossRoster('100', roster).spots).toBe(2);
    expect(splitAcrossRoster('100', roster).each).toBe(50);
  });

  it('ignores anyone not confirmed', () => {
    const roster = [entry({ signupId: 'a' }), entry({ signupId: 'b', status: 'waitlisted' }), entry({ signupId: 'c', status: 'cancelled' })];

    expect(splitAcrossRoster('100', roster).spots).toBe(1);
  });

  it('rounds to the cent', () => {
    const roster = [entry({ signupId: 'a' }), entry({ signupId: 'b' }), entry({ signupId: 'c' })];

    expect(splitAcrossRoster('100', roster).each).toBe(33.33);
  });

  it('offers nothing to split when the cost is zero or unset', () => {
    const roster = [entry()];

    expect(splitAcrossRoster('0', roster).canSplit).toBe(false);
    expect(splitAcrossRoster('', roster).canSplit).toBe(false);
    expect(splitAcrossRoster('not a number', roster).canSplit).toBe(false);
  });

  it('offers nothing to split when nobody is confirmed', () => {
    expect(splitAcrossRoster('100', []).canSplit).toBe(false);
    expect(splitAcrossRoster('100', null).canSplit).toBe(false);
    expect(splitAcrossRoster('100', [entry({ status: 'waitlisted' })]).canSplit).toBe(false);
  });
});

describe('announcementNotice', () => {
  it('names who was emailed, because a count cannot be checked', () => {
    expect(announcementNotice({ sent: 2, failed: 0, recipients: ['Kevin Kim', 'Jane Doe'] })).toBe(
      'Emailed 2: Kevin Kim, Jane Doe.'
    );
  });

  it('reports failures and points at the logs', () => {
    expect(announcementNotice({ sent: 1, failed: 2, recipients: ['Kevin Kim'] })).toMatch(
      /Emailed 1: Kevin Kim\. 2 failed to send — check the logs\./
    );
  });

  it('treats a skipped send as an answer, not a failure', () => {
    // "Everyone has already paid" is a legitimate reply to the button.
    expect(announcementNotice({ skipped: true, reason: 'everyone has already paid' })).toBe(
      'Nothing sent — everyone has already paid'
    );
  });

  it('does not claim to have emailed anyone when nobody was', () => {
    expect(announcementNotice({ sent: 0, failed: 0, recipients: [] })).toBe('Emailed 0: .');
  });
});

describe('sessionInputsFor', () => {
  const session: AdminSessionView = {
    sessionId: '2026-07-10',
    gameDate: '2026-07-10',
    gameTime: '18:00',
    capacity: 12,
    numFields: 1,
    status: 'open',
    pricePerSpot: 10,
    locationArea: 'Mississauga',
    locationName: 'Iceland Park Diamond 3',
    locationUrl: 'https://maps.example/x',
    teamsStatus: '',
    cost: 240,
  };

  it('fills every editable box from the session', () => {
    // All eight together: missing one leaves a box showing the previous week's
    // value, which the organizer would then save.
    expect(sessionInputsFor(session)).toEqual({
      capacity: '12',
      cost: '240',
      gameDate: '2026-07-10',
      gameTime: '18:00',
      price: '10',
      area: 'Mississauga',
      fieldName: 'Iceland Park Diamond 3',
      fieldUrl: 'https://maps.example/x',
    });
  });

  it('renders a zero as "0" rather than an empty box', () => {
    expect(sessionInputsFor({ ...session, cost: 0, pricePerSpot: 0 })).toMatchObject({ cost: '0', price: '0' });
  });
});

/**
 * The console's request policy. It was four near-identical handlers closed
 * over React state — the same four the homepage had, left in place when those
 * were collapsed.
 */
describe('adminRequestFor', () => {
  const bodyOf = (action: AdminAction) => {
    const { init } = adminRequestFor(action);
    return init.body ? JSON.parse(String(init.body)) : null;
  };

  it('revises a session by PATCHing it', () => {
    const action: AdminAction = { kind: 'reviseSession', sessionId: '2026-07-10', updates: { capacity: 20 } };

    expect(adminRequestFor(action).url).toBe('/api/admin/sessions/2026-07-10');
    expect(adminRequestFor(action).init.method).toBe('PATCH');
    expect(bodyOf(action)).toEqual({ capacity: 20 });
  });

  it('sends an announcement to the named path under the session', () => {
    const action: AdminAction = { kind: 'announce', sessionId: '2026-07-10', path: 'notify', body: { note: 'Moved' } };

    expect(adminRequestFor(action).url).toBe('/api/admin/sessions/2026-07-10/notify');
    expect(bodyOf(action)).toEqual({ note: 'Moved' });
  });

  it('sends an empty body for an announcement that carries no note', () => {
    expect(bodyOf({ kind: 'announce', sessionId: '2026-07-10', path: 'payment-reminders' })).toEqual({});
  });

  it('overrides a signup by PATCHing the signup, not the session', () => {
    const action: AdminAction = { kind: 'overrideSignup', signupId: 's1', updates: { paid: true } };

    expect(adminRequestFor(action).url).toBe('/api/admin/signups/s1');
    expect(bodyOf(action)).toEqual({ paid: true });
  });

  it('removes a signup by DELETE, not by an override', () => {
    // A hard delete of the row, distinct from setting status to cancelled.
    const { url, init } = adminRequestFor({ kind: 'removeSignup', signupId: 's1' });

    expect(url).toBe('/api/admin/signups/s1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('encodes ids rather than pasting them into the path', () => {
    expect(adminRequestFor({ kind: 'removeSignup', signupId: 'a/b?c' }).url).toBe('/api/admin/signups/a%2Fb%3Fc');
  });

  it('gives each action its own fallback, so a failure says which one failed', () => {
    expect(adminRequestFor({ kind: 'removeSignup', signupId: 's1' }).fallbackError).toBe('Remove failed');
    expect(adminRequestFor({ kind: 'announce', sessionId: 's', path: 'notify' }).fallbackError).toBe('Send failed');
  });
});

describe('adminFailureMessage', () => {
  it('prefers the server’s own words, which name the actual problem', () => {
    expect(adminFailureMessage({ error: 'Kevin Kim already has an active signup' }, 'Update failed')).toMatch(
      /Kevin Kim already has an active signup/
    );
  });

  it('falls back when the response says nothing useful', () => {
    expect(adminFailureMessage({}, 'Remove failed')).toBe('Remove failed');
    expect(adminFailureMessage(null, 'Send failed')).toBe('Send failed');
    expect(adminFailureMessage({ error: '' }, 'Update failed')).toBe('Update failed');
  });
});
