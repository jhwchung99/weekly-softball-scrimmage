import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSession } from '../../test/fakeSheets';
import { getWeeklyMilestones } from '../time';

/**
 * The steps left to forget are done by hand, so the app notices for itself,
 * from state it already holds.
 *
 * Everything below is about the pure half, because that is where the judgement
 * is: what counts as "this was not done", and — just as important — what
 * does not, since a watchdog that cries wolf gets muted and then it is worse
 * than nothing.
 */

const getRedis = vi.fn(() => null);
vi.mock('../redis', () => ({ getRedis }));
import type { PushOptions } from '../ntfy';
const sendPush = vi.fn<(title: string, message: string, options?: PushOptions) => Promise<void>>(async () => undefined);
vi.mock('../ntfy', () => ({ sendPush }));

const { missedJobsFor,
  missedJobsForWeek, reportMissedJobs, forgetWatchdogReports } = await import('../weekWatchdog');

// A Friday, so currentWeekGameDayCandidates lines up with the fixture.
const GAME_DATE = '2026-07-10';
const M = getWeeklyMilestones(GAME_DATE, '18:00');
const HOUR = 60 * 60 * 1000;

/** A moment `hours` past a milestone, so a case names its own lateness. */
const past = (at: Date, hours: number) => new Date(at.getTime() + hours * HOUR);

const week = (over: Parameters<typeof makeSession>[0] = {}) =>
  makeSession({ sessionId: GAME_DATE, gameDate: GAME_DATE, gameTime: '18:00', ...over });

const jobs = (session: ReturnType<typeof makeSession>, now: Date) => missedJobsFor(session, now).map((m) => m.job);
/** The week-level view, which is where "nothing is scheduled at all" lives. */
const weekJobs = (sessions: ReturnType<typeof makeSession>[], now: Date) =>
  missedJobsForWeek(sessions, now).map((m) => m.job);

beforeEach(() => {
  vi.clearAllMocks();
  forgetWatchdogReports();
  getRedis.mockReturnValue(null);
});

describe('missedJobsForWeek — nothing scheduled', () => {
  it('reports a week with nothing scheduled at all', () => {
    // Reported rather than fixed by inventing a session — see missedJobsForWeek.
    expect(weekJobs([], past(M.registrationOpensAt, 3))).toContain('nothing-scheduled');
  });

  it('says nothing about an empty week before registration was due to open', () => {
    expect(weekJobs([], new Date(M.registrationOpensAt.getTime() - HOUR))).toEqual([]);
  });

  it('checks every session the week holds, not just the first', () => {
    const SUNDAY = getWeeklyMilestones('2026-07-12', '18:00');
    const friday = week({ teamsStatus: 'posted', remindersSentAt: '2026-07-10T18:00:00.000Z' });
    const sunday = week({ sessionId: '2026-07-12', gameDate: '2026-07-12', teamsStatus: '', remindersSentAt: '2026-07-12T17:00:00.000Z' });

    const reported = missedJobsForWeek([friday, sunday], past(SUNDAY.cutoffStart, 3));

    expect(reported.map((m) => [m.sessionId, m.job])).toEqual([['2026-07-12', 'generate-teams']]);
  });
});

// Registration follows each session's own window, with nothing to run
// (ADR-0009), so there is nothing about it to miss. A stored 'closed' inside
// the window used to be reported as a job that never fired.
describe('missedJobsFor — registration', () => {
  it('says nothing about a session stored closed inside its window', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: '' }), past(M.registrationOpensAt, 3))).toEqual([]);
  });

  it('says nothing about a session stored open past its close', () => {
    expect(jobs(week({ status: 'open', teamsStatus: '' }), past(M.registrationClosesAt, 3))).toEqual([]);
  });
});

describe('missedJobsFor — generate-teams', () => {
  it('reports a locked roster with no teams', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: '' }), past(M.cutoffStart, 3))).toContain('generate-teams');
  });

  it('says nothing once teams exist', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: 'draft' }), past(M.cutoffStart, 3))).toEqual([]);
  });

  it('says nothing for a practice week, which has no sides to pick', () => {
    expect(jobs(week({ format: 'practice', teamsStatus: '' }), past(M.cutoffStart, 3))).not.toContain('generate-teams');
  });

  it('says nothing before the roster locks', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: '' }), past(M.registrationClosesAt, 1))).toEqual([]);
  });
});

describe('missedJobsFor — a cancelled week', () => {
  it('reports nothing at all, because nothing is owed to it', () => {
    // Cancelling is a decision, not a failure. Alerting on it would train the
    // organizer to ignore this.
    expect(jobs(week({ status: 'cancelled', teamsStatus: '' }), past(M.cutoffStart, 24))).toEqual([]);
  });
});

describe('reportMissedJobs', () => {
  it('pushes one alert per missed job', async () => {
    await reportMissedJobs([], past(M.registrationOpensAt, 3));

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toBe('Nothing scheduled');
  });

  it('says what is missing, with no pointer to a workflow that no longer exists', async () => {
    await reportMissedJobs([], past(M.registrationOpensAt, 3));

    expect(String(sendPush.mock.calls[0][1])).toMatch(/^Nothing is scheduled\./);
    expect(String(sendPush.mock.calls[0][1])).not.toMatch(/workflow|Actions/);
  });

  it('wakes the phone when players are blocked, and does not otherwise', async () => {
    await reportMissedJobs([], past(M.registrationOpensAt, 3));
    expect(sendPush.mock.calls[0][2]).toMatchObject({ priority: 5 });

    sendPush.mockClear();
    forgetWatchdogReports();
    await reportMissedJobs([week({ status: 'closed', teamsStatus: '' })], past(M.cutoffStart, 3));
    expect(sendPush.mock.calls[0][2]).toMatchObject({ priority: 4 });
  });

  it('sends nothing when the week is on track', async () => {
    await reportMissedJobs([week({ status: 'open' })], past(M.registrationOpensAt, 3));

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('does not push once per visitor on a busy Monday', async () => {
    const now = past(M.registrationOpensAt, 3);
    for (let i = 0; i < 5; i++) await reportMissedJobs([], now);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('dedupes across instances when Redis is there, which is the real deployment', async () => {
    const claimed = new Set<string>();
    getRedis.mockReturnValue({
      set: vi.fn(async (key: string) => (claimed.has(key) ? null : (claimed.add(key), 'OK'))),
    } as never);

    const now = past(M.registrationOpensAt, 3);
    await reportMissedJobs([], now);
    forgetWatchdogReports(); // a different serverless instance, with no memory
    await reportMissedJobs([], now);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('still reports with no Redis, because silence is the failure being fixed', async () => {
    getRedis.mockReturnValue(null);
    await reportMissedJobs([], past(M.registrationOpensAt, 3));

    expect(sendPush).toHaveBeenCalled();
  });

  it('tries again on the next page load when a push fails, instead of going quiet for 12 hours', async () => {
    const claimed = new Set<string>();
    getRedis.mockReturnValue({
      set: vi.fn(async (key: string) => (claimed.has(key) ? null : (claimed.add(key), 'OK'))),
      del: vi.fn(async (key: string) => void claimed.delete(key)),
    } as never);
    sendPush.mockRejectedValueOnce(new Error('ntfy 502'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const now = past(M.registrationOpensAt, 3);
    await reportMissedJobs([], now);
    await reportMissedJobs([], now);

    expect(sendPush).toHaveBeenCalledTimes(2);
    vi.mocked(console.error).mockRestore();
  });

  it('swallows a push failure rather than failing the page load it runs off', async () => {
    sendPush.mockRejectedValue(new Error('ntfy down'));

    await expect(reportMissedJobs([], past(M.registrationOpensAt, 3))).resolves.toBeUndefined();
  });
});

describe('missedJobsFor — game-day-email', () => {
  // The email is a button now, so what is watched is the organizer forgetting
  // it, not a workflow failing.
  const twoHoursBefore = new Date(M.gameStart.getTime() - 2 * HOUR);

  it('says nothing until the game is close', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: 'posted' }), past(M.cutoffStart, 1))).not.toContain(
      'game-day-email'
    );
  });

  it('reports an unsent email in the last two hours before the game', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: 'posted' }), past(twoHoursBefore, 1))).toContain(
      'game-day-email'
    );
  });

  it('stays quiet once it has been sent', () => {
    const sent = week({ status: 'closed', teamsStatus: 'posted', remindersSentAt: '2026-07-10T18:00:00.000Z' });
    expect(jobs(sent, past(twoHoursBefore, 1))).not.toContain('game-day-email');
  });

  it('stops once the game has started, when the nudge would be useless', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: 'posted' }), past(M.gameStart, 1))).not.toContain(
      'game-day-email'
    );
  });

  it('says nothing about a cancelled week', () => {
    expect(jobs(week({ status: 'cancelled' }), past(twoHoursBefore, 1))).toEqual([]);
  });

  it('follows a session that locks the night before', () => {
    // An early game: the lock moves, and the nudge still hangs off the game,
    // not off the lock.
    const early = makeSession({
      sessionId: '2026-07-11',
      gameDate: '2026-07-11',
      gameTime: '10:00',
      status: 'closed',
      teamsStatus: 'posted',
      rosterLockAt: '2026-07-11T00:00:00.000Z',
    });
    const anHourBeforeTenAm = new Date('2026-07-11T13:00:00.000Z');

    expect(missedJobsFor(early, anHourBeforeTenAm).map((m) => m.job)).toContain('game-day-email');
  });
});
