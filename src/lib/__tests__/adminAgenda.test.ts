import { describe, it, expect } from 'vitest';
import { agendaFor, agendaForAll } from '../adminAgenda';
import { makeSession, makeSignup } from '../../test/fakeSheets';
import { getWeeklyMilestones } from '../time';
import type { AdminRosterEntry } from '../views';

/** Friday 2026-07-10 at 6pm, the same week the other suites use. */
const GAME = '2026-07-10';
const M = getWeeklyMilestones(GAME, '18:00');
const HOUR = 60 * 60 * 1000;
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * HOUR);

const session = (over: Parameters<typeof makeSession>[0] = {}) =>
  makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00', ...over });

/** Distinct ids matter: spots are counted by signupId and pairId, so three
 * rows sharing one id are one spot, not three. */
let nextId = 0;
const confirmed = (over: Partial<AdminRosterEntry> = {}) =>
  makeSignup({ signupId: `s-${(nextId += 1)}`, sessionId: GAME, status: 'confirmed', ...over }) as unknown as AdminRosterEntry;

const messages = (...args: Parameters<typeof agendaFor>) => agendaFor(...args).map((i) => i.message);

describe('agendaFor — registration', () => {
  it('leads with players being blocked', () => {
    // Inside the window and still closed: nobody can sign up right now, which
    // outranks everything else on the session.
    const items = agendaFor(session({ status: 'closed' }), null, at(M.registrationOpensAt, 1));

    expect(items[0].message).toMatch(/should be open now/);
    expect(items[0].urgency).toBe(0);
  });

  it('says nothing about a session that is open when it should be', () => {
    expect(messages(session({ status: 'open' }), null, at(M.registrationOpensAt, 1))).toEqual([]);
  });

  it('reports a session left marked open past its window', () => {
    // Nobody can actually sign up — the gate is derived from the schedule —
    // but the headcount the permit is booked from never went out.
    expect(messages(session({ status: 'open' }), null, at(M.registrationClosesAt, 1))).toEqual([
      expect.stringMatching(/still marked open/),
    ]);
  });

  it('has nothing to say about a cancelled session', () => {
    expect(messages(session({ status: 'closed' }), null, at(M.registrationOpensAt, 1))).not.toEqual([]);
    expect(messages(session({ status: 'cancelled' }), null, at(M.registrationOpensAt, 1))).toEqual([]);
  });
});

describe('agendaFor — the light-turnout poll', () => {
  const light = () => [confirmed(), confirmed(), confirmed()];

  it('offers the poll once registration has closed and turnout is under the threshold', () => {
    const items = messages(session({ status: 'closed', practicePollThreshold: 16 }), light(), at(M.registrationClosesAt, 1));

    expect(items).toContainEqual(expect.stringMatching(/only 3 confirmed, under the 16/));
  });

  it('says nothing once the roster has locked, when the format is settled anyway', () => {
    const items = messages(session({ status: 'closed', practicePollThreshold: 16 }), light(), at(M.cutoffStart, 1));

    expect(items).not.toContainEqual(expect.stringMatching(/under the 16/));
  });

  it('says nothing when the poll has already been asked', () => {
    const asked = session({ status: 'closed', practicePollThreshold: 16, practicePollStatus: 'closed' });

    expect(messages(asked, light(), at(M.registrationClosesAt, 1))).not.toContainEqual(expect.stringMatching(/under the 16/));
  });

  it('skips the headcount items entirely when no roster was supplied', () => {
    // The console holds the roster for the session being edited and not for
    // the others; guessing would be worse than staying quiet.
    expect(messages(session({ status: 'closed', practicePollThreshold: 16 }), null, at(M.registrationClosesAt, 1))).toEqual([]);
  });
});

describe('agendaFor — after the lock', () => {
  const locked = at(M.cutoffStart, 1);

  it('reports missing teams, the unsent email and an unbooked field', () => {
    const items = messages(session({ status: 'closed', teamsStatus: '', remindersSentAt: '', locationName: '' }), null, locked);

    expect(items).toContainEqual(expect.stringMatching(/teams have not been generated/));
    expect(items).toContainEqual(expect.stringMatching(/game-day email/));
    expect(items).toContainEqual(expect.stringMatching(/no field is booked/));
  });

  it('does not ask for teams on a BP/Practice week, which has no sides', () => {
    const practice = session({ status: 'closed', format: 'practice', teamsStatus: '' });

    expect(messages(practice, null, locked)).not.toContainEqual(expect.stringMatching(/teams/));
  });

  it('counts the unpaid once the figure is final', () => {
    const roster = [confirmed({ paid: true }), confirmed({ paid: false }), confirmed({ paid: false })];
    const priced = session({ status: 'closed', pricePerSpot: 10 });

    expect(messages(priced, roster, locked)).toContainEqual(expect.stringMatching(/2 players still unpaid/));
  });

  it('says nothing about money before the lock, when the figure can still move', () => {
    const roster = [confirmed({ paid: false })];
    const priced = session({ status: 'closed', pricePerSpot: 10 });

    expect(messages(priced, roster, at(M.registrationClosesAt, 1))).not.toContainEqual(expect.stringMatching(/unpaid/));
  });

  it('stops asking once the game has been played', () => {
    const played = session({ status: 'closed', teamsStatus: '', remindersSentAt: '' });

    expect(messages(played, null, at(M.gameStart, 1))).toEqual([]);
  });
});

describe('agendaForAll', () => {
  it('is one list across every session, most urgent first', () => {
    // The whole point: the organizer reads one list rather than opening three
    // dashboards to find out which session needs them.
    const friday = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00', status: 'open' });
    const sunday = makeSession({ sessionId: '2026-07-12', gameDate: '2026-07-12', gameTime: '18:00', status: 'closed' });

    const items = agendaForAll(
      [
        { session: friday, roster: null },
        { session: sunday, roster: null },
      ],
      at(M.registrationOpensAt, 1)
    );

    // Sunday is blocked (urgency 0); Friday is fine at this instant.
    expect(items.map((i) => i.sessionId)).toEqual(['2026-07-12']);
  });

  it('is empty when every session is on track', () => {
    const ok = makeSession({ sessionId: GAME, gameDate: GAME, gameTime: '18:00', status: 'open' });

    expect(agendaForAll([{ session: ok, roster: null }], at(M.registrationOpensAt, 1))).toEqual([]);
  });
});
