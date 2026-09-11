import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSession } from '../../test/fakeSheets';
import { getWeeklyMilestones } from '../time';

/**
 * GitHub disables `schedule` triggers on a repository with no commits for 60
 * days. A cron that *fails* emails the last committer; a cron that never
 * *fires* surfaces nowhere. So the app is made to notice for itself, from
 * state it already holds.
 *
 * Everything below is about the pure half, because that is where the judgement
 * is: what counts as "this job did not run", and — just as important — what
 * does not, since a watchdog that cries wolf gets muted and then it is worse
 * than nothing.
 */

const getRedis = vi.fn(() => null);
vi.mock('../redis', () => ({ getRedis }));
import type { PushOptions } from '../ntfy';
const sendPush = vi.fn<(title: string, message: string, options?: PushOptions) => Promise<void>>(async () => undefined);
vi.mock('../ntfy', () => ({ sendPush }));

const { missedJobsFor, reportMissedJobs, forgetWatchdogReports } = await import('../weekWatchdog');

// A Friday, so currentWeekGameDayCandidates lines up with the fixture.
const GAME_DATE = '2026-07-10';
const M = getWeeklyMilestones(GAME_DATE, '18:00');
const HOUR = 60 * 60 * 1000;

/** A moment `hours` past a milestone, so a case names its own lateness. */
const past = (at: Date, hours: number) => new Date(at.getTime() + hours * HOUR);

const week = (over: Parameters<typeof makeSession>[0] = {}) =>
  makeSession({ sessionId: GAME_DATE, gameDate: GAME_DATE, gameTime: '18:00', ...over });

const jobs = (session: ReturnType<typeof makeSession> | null, now: Date) => missedJobsFor(session, now).map((m) => m.job);

beforeEach(() => {
  vi.clearAllMocks();
  forgetWatchdogReports();
  getRedis.mockReturnValue(null);
});

describe('missedJobsFor — open-registration', () => {
  it('reports a week that never got created', () => {
    // The worst case: Monday came, registration never opened, and the first
    // signal without this is a player asking why they cannot sign up.
    expect(jobs(null, past(M.registrationOpensAt, 3))).toContain('open-registration');
  });

  it('reports a session still closed inside its own registration window', () => {
    expect(jobs(week({ status: 'closed' }), past(M.registrationOpensAt, 3))).toContain('open-registration');
  });

  it('says nothing before registration was due to open', () => {
    expect(jobs(null, new Date(M.registrationOpensAt.getTime() - HOUR))).toEqual([]);
  });

  it('allows the job to be late before calling it missed', () => {
    // GitHub's scheduled runs are routinely delayed, and open-registration
    // itself tolerates being up to 59 minutes off its hour. Alerting at one
    // minute past would make the alert meaningless.
    expect(jobs(null, past(M.registrationOpensAt, 1))).toEqual([]);
  });

  it('says nothing about a week that opened correctly', () => {
    expect(jobs(week({ status: 'open' }), past(M.registrationOpensAt, 3))).toEqual([]);
  });

  it('does not call a properly closed week un-opened', () => {
    // 'closed' is the correct state once the window has passed, and a blank
    // status row parses as 'closed' — so this check has to be windowed or it
    // fires every week from Tuesday onward.
    expect(jobs(week({ status: 'closed', teamsStatus: 'posted' }), past(M.registrationClosesAt, 3))).toEqual([]);
  });
});

describe('missedJobsFor — close-registration', () => {
  it('reports a week left open past its close', () => {
    // Signups are already refused: the gate is derived from the clock. What
    // was lost is the headcount the organizer books a permit from.
    expect(jobs(week({ status: 'open', teamsStatus: 'posted' }), past(M.registrationClosesAt, 3))).toContain(
      'close-registration'
    );
  });

  it('says nothing while registration is legitimately open', () => {
    expect(jobs(week({ status: 'open' }), past(M.registrationOpensAt, 3))).toEqual([]);
  });
});

describe('missedJobsFor — generate-teams', () => {
  it('reports a locked roster with no teams', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: '' }), past(M.cutoffStart, 3))).toContain('generate-teams');
  });

  it('says nothing once teams exist', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: 'draft' }), past(M.cutoffStart, 3))).toEqual([]);
  });

  it('says nothing before the roster locks', () => {
    expect(jobs(week({ status: 'closed', teamsStatus: '' }), past(M.registrationClosesAt, 1))).toEqual([]);
  });
});

describe('missedJobsFor — a cancelled week', () => {
  it('reports nothing at all, because no job should have run', () => {
    // Cancelling is a decision, not a failure. Alerting on it would train the
    // organizer to ignore this.
    expect(jobs(week({ status: 'cancelled', teamsStatus: '' }), past(M.cutoffStart, 24))).toEqual([]);
  });
});

describe('reportMissedJobs', () => {
  it('pushes one alert per missed job', async () => {
    await reportMissedJobs(null, past(M.registrationOpensAt, 3));

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toContain('open-registration');
  });

  it('says how to fix it, since the recovery is a button someone has to press', async () => {
    await reportMissedJobs(null, past(M.registrationOpensAt, 3));

    expect(String(sendPush.mock.calls[0][1])).toMatch(/Actions tab/);
  });

  it('wakes the phone when players are blocked, and does not otherwise', async () => {
    await reportMissedJobs(null, past(M.registrationOpensAt, 3));
    expect(sendPush.mock.calls[0][2]).toMatchObject({ priority: 5 });

    sendPush.mockClear();
    forgetWatchdogReports();
    await reportMissedJobs(week({ status: 'closed', teamsStatus: '' }), past(M.cutoffStart, 3));
    expect(sendPush.mock.calls[0][2]).toMatchObject({ priority: 4 });
  });

  it('sends nothing when the week is on track', async () => {
    await reportMissedJobs(week({ status: 'open' }), past(M.registrationOpensAt, 3));

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('does not push once per visitor on a busy Monday', async () => {
    const now = past(M.registrationOpensAt, 3);
    for (let i = 0; i < 5; i++) await reportMissedJobs(null, now);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('dedupes across instances when Redis is there, which is the real deployment', async () => {
    const claimed = new Set<string>();
    getRedis.mockReturnValue({
      set: vi.fn(async (key: string) => (claimed.has(key) ? null : (claimed.add(key), 'OK'))),
    } as never);

    const now = past(M.registrationOpensAt, 3);
    await reportMissedJobs(null, now);
    forgetWatchdogReports(); // a different serverless instance, with no memory
    await reportMissedJobs(null, now);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('still reports with no Redis, because silence is the failure being fixed', async () => {
    getRedis.mockReturnValue(null);
    await reportMissedJobs(null, past(M.registrationOpensAt, 3));

    expect(sendPush).toHaveBeenCalled();
  });

  it('swallows a push failure rather than failing the page load it runs off', async () => {
    sendPush.mockRejectedValue(new Error('ntfy down'));

    await expect(reportMissedJobs(null, past(M.registrationOpensAt, 3))).resolves.toBeUndefined();
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
