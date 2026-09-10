import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSession } from '../../test/fakeSheets';

/**
 * The quota is 60 Sheets reads a minute for the whole app, and the two routes
 * that read this are unauthenticated. So what is being tested is not "does it
 * remember" but "how few reads does a crowd cost", which is the collapsing
 * below rather than the caching.
 */

const getSessionByAnyId = vi.fn();
vi.mock('../../sheets/sessions', () => ({ getSessionByAnyId }));

const { currentWeekSession, forgetCurrentWeek } = await import('../currentWeek');

const SESSION = makeSession();
const T0 = 1_000_000;

/** Held open until `settle` is called, so overlapping callers can be observed. */
function pending() {
  let settle: (value: typeof SESSION | null) => void = () => {};
  const promise = new Promise<typeof SESSION | null>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetCurrentWeek();
  getSessionByAnyId.mockResolvedValue(SESSION);
});

describe('currentWeekSession', () => {
  it('reads once and answers everyone else from the cache', async () => {
    expect(await currentWeekSession(T0)).toEqual(SESSION);
    expect(await currentWeekSession(T0 + 1_000)).toEqual(SESSION);

    expect(getSessionByAnyId).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst onto one read, which is the Monday-9am case', async () => {
    // Twenty people refresh while the first read is still in flight. Caching
    // the *result* would cost twenty reads here — a third of the app's minute.
    const first = pending();
    getSessionByAnyId.mockReturnValueOnce(first.promise);

    const crowd = Array.from({ length: 20 }, () => currentWeekSession(T0));
    first.settle(SESSION);

    expect(await Promise.all(crowd)).toEqual(Array(20).fill(SESSION));
    expect(getSessionByAnyId).toHaveBeenCalledTimes(1);
  });

  it('reads again once the window has passed', async () => {
    await currentWeekSession(T0);
    await currentWeekSession(T0 + 30_000);

    expect(getSessionByAnyId).toHaveBeenCalledTimes(2);
  });

  it('holds a found session for the full window', async () => {
    await currentWeekSession(T0);
    await currentWeekSession(T0 + 29_999);

    expect(getSessionByAnyId).toHaveBeenCalledTimes(1);
  });

  it('caches "no game this week" only briefly, because that is what is about to change', async () => {
    // The cron creates the week at 9am Monday and players are watching for it.
    // Being told there is no game for half a minute after there is would be
    // the worst thirty seconds of the week to be wrong in.
    getSessionByAnyId.mockResolvedValue(null);

    expect(await currentWeekSession(T0)).toBeNull();
    await currentWeekSession(T0 + 5_000);

    expect(getSessionByAnyId).toHaveBeenCalledTimes(2);
  });

  it('still shortcuts a repeated miss inside its own window', async () => {
    getSessionByAnyId.mockResolvedValue(null);

    await currentWeekSession(T0);
    await currentWeekSession(T0 + 4_999);

    expect(getSessionByAnyId).toHaveBeenCalledTimes(1);
  });

  it('does not serve a failed read to everyone for the next half minute', async () => {
    getSessionByAnyId.mockRejectedValueOnce(new Error('Sheets is down'));

    await expect(currentWeekSession(T0)).rejects.toThrow('Sheets is down');
    expect(await currentWeekSession(T0 + 1)).toEqual(SESSION);
  });

  it('forgets on request, so a test or a dev server starts cold', async () => {
    await currentWeekSession(T0);
    forgetCurrentWeek();
    await currentWeekSession(T0);

    expect(getSessionByAnyId).toHaveBeenCalledTimes(2);
  });
});
