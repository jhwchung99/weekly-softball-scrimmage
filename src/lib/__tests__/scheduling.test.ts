import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSessionsModule, resetFakeStore, makeSession } from '../../test/fakeSheets';
import type { FakeStore } from '../../test/fakeSheets';

const store = vi.hoisted((): FakeStore => ({ sessions: new Map(), signups: new Map(), players: new Map() }));

vi.mock('../../sheets/sessions', () => fakeSessionsModule(store));

const { openRegistrationForUpcomingSession, closeRegistrationForCurrentSession } = await import('../scheduling');

beforeEach(() => {
  resetFakeStore(store);
  vi.clearAllMocks();
});

// 2026-07-06T13:00:00Z is 9:00am EDT on Monday 2026-07-06; that week's
// Fri/Sat/Sun are 07-10/07-11/07-12 (see time.test.ts for the same dates).
const MONDAY_9AM = new Date('2026-07-06T13:00:00.000Z');
// 2026-07-09T01:00:00Z is 9:00pm EDT on Wednesday 2026-07-08 (crosses into
// Thursday UTC) — same instant as the Wednesday-close case in time.test.ts.
const WEDNESDAY_9PM = new Date('2026-07-09T01:00:00.000Z');

describe('openRegistrationForUpcomingSession', () => {
  it('creates a default Friday session when nothing exists yet for the week', async () => {
    const result = await openRegistrationForUpcomingSession(MONDAY_9AM);

    expect(result).toEqual({ sessionId: '2026-07-10', skipped: false });
    expect(store.sessions.get('2026-07-10')).toMatchObject({ gameDate: '2026-07-10', status: 'open' });
  });

  it('opens the already-scheduled Saturday session instead of creating a duplicate Friday one', async () => {
    store.sessions.set('2026-07-11', makeSession({ sessionId: '2026-07-11', gameDate: '2026-07-11', status: 'closed' }));

    const result = await openRegistrationForUpcomingSession(MONDAY_9AM);

    expect(result).toEqual({ sessionId: '2026-07-11', skipped: false });
    expect(store.sessions.get('2026-07-11')?.status).toBe('open');
    expect(store.sessions.has('2026-07-10')).toBe(false); // no default Friday row created alongside it
  });

  it('skips without touching the sheet when not near 9am ET (DST-offset duplicate firing)', async () => {
    const result = await openRegistrationForUpcomingSession(new Date('2026-07-06T14:00:00.000Z'));

    expect(result.skipped).toBe(true);
    expect(store.sessions.size).toBe(0);
  });
});

describe('closeRegistrationForCurrentSession', () => {
  it('closes whichever of Friday/Saturday/Sunday has this week\'s session', async () => {
    store.sessions.set('2026-07-12', makeSession({ sessionId: '2026-07-12', gameDate: '2026-07-12', status: 'open' }));

    const result = await closeRegistrationForCurrentSession(WEDNESDAY_9PM);

    expect(result).toEqual({ sessionId: '2026-07-12', skipped: false });
    expect(store.sessions.get('2026-07-12')?.status).toBe('closed');
  });

  it('skips when no session exists for the week under any of the three candidates', async () => {
    const result = await closeRegistrationForCurrentSession(WEDNESDAY_9PM);
    expect(result).toEqual({ sessionId: '2026-07-10', skipped: true, reason: expect.stringMatching(/no session exists/i) });
  });

  it('skips without touching the sheet when not near 9pm ET (DST-offset duplicate firing)', async () => {
    store.sessions.set('2026-07-10', makeSession({ sessionId: '2026-07-10', gameDate: '2026-07-10', status: 'open' }));

    // 1 hour after the real 9pm ET instant — the seasonal EST/EDT duplicate.
    const result = await closeRegistrationForCurrentSession(new Date('2026-07-09T02:00:00.000Z'));

    expect(result.skipped).toBe(true);
    expect(store.sessions.get('2026-07-10')?.status).toBe('open');
  });
});
