import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSession } from '../../test/fakeSheets';

/**
 * The quota is 60 Sheets reads a minute for the whole app, and the two routes
 * that read this are unauthenticated. So what is being tested is not "does it
 * remember" but "how few reads does a crowd cost", which is the collapsing
 * below rather than the caching.
 */

const listSessions = vi.fn();
vi.mock('../../sheets/sessions', () => ({ listSessions }));

const reportMissedJobs = vi.fn(async () => undefined);
vi.mock('../weekWatchdog', () => ({ reportMissedJobs }));

const { upcomingSessions, forgetCurrentWeek } = await import('../currentWeek');

/** Far enough out that it is upcoming whenever this suite runs. */
const SESSION = makeSession({ sessionId: '2099-01-01', gameDate: '2099-01-01' });
/** A real instant, not a bare epoch offset: the cache window arithmetic does
 * not care, but the "has this game date passed" filter compares against
 * today's date in Eastern time and would read 1970 as today. */
const T0 = Date.parse('2026-09-22T12:00:00.000Z');

/** Held open until `settle` is called, so overlapping callers can be observed. */
function pending() {
  let settle: (value: (typeof SESSION)[]) => void = () => {};
  const promise = new Promise<(typeof SESSION)[]>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetCurrentWeek();
  listSessions.mockResolvedValue([SESSION]);
});

describe('upcomingSessions', () => {
  it('reads once and answers everyone else from the cache', async () => {
    expect(await upcomingSessions(T0)).toEqual([SESSION]);
    expect(await upcomingSessions(T0 + 1_000)).toEqual([SESSION]);
    expect(await upcomingSessions(T0 + 29_000)).toEqual([SESSION]);

    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('collapses a crowd arriving mid-read onto one read', async () => {
    // The Monday 9am case: twenty people refresh at once, before the first
    // read has come back. Each must join that read rather than start its own.
    const { promise, settle } = pending();
    listSessions.mockReturnValueOnce(promise);

    const waiting = Array.from({ length: 20 }, () => upcomingSessions(T0));
    settle([SESSION]);

    expect(await Promise.all(waiting)).toEqual(Array.from({ length: 20 }, () => [SESSION]));
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('reads again once the window has passed', async () => {
    await upcomingSessions(T0);
    await upcomingSessions(T0 + 31_000);

    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('caches an empty list only briefly, because it is about to change', async () => {
    // "Nothing is scheduled" is the answer players are watching for on a
    // Monday morning, so it must not be held for the full window.
    listSessions.mockResolvedValue([]);

    expect(await upcomingSessions(T0)).toEqual([]);
    await upcomingSessions(T0 + 6_000);

    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('does not serve a failed read to everyone for the next thirty seconds', async () => {
    listSessions.mockRejectedValueOnce(new Error('Sheets is down'));

    await expect(upcomingSessions(T0)).rejects.toThrow('Sheets is down');

    listSessions.mockResolvedValue([SESSION]);
    expect(await upcomingSessions(T0 + 100)).toEqual([SESSION]);
  });

  it('leaves out sessions whose game date has passed, soonest first', async () => {
    const past = makeSession({ sessionId: '2000-01-01', gameDate: '2000-01-01' });
    const later = makeSession({ sessionId: '2099-06-01', gameDate: '2099-06-01' });
    listSessions.mockResolvedValue([later, past, SESSION]);

    expect((await upcomingSessions(T0)).map((s) => s.sessionId)).toEqual(['2099-01-01', '2099-06-01']);
  });

  it('returns every upcoming session rather than the first', async () => {
    // A Sunday game beside a Friday one used to be invisible: the lookup took
    // the first of Friday/Saturday/Sunday that had a row and stopped.
    const sunday = makeSession({ sessionId: '2099-01-03', gameDate: '2099-01-03' });
    listSessions.mockResolvedValue([SESSION, sunday]);

    expect((await upcomingSessions(T0)).map((s) => s.sessionId)).toEqual(['2099-01-01', '2099-01-03']);
  });
});
