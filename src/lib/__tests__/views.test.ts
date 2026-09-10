import { describe, it, expect } from 'vitest';
import { makeSignup } from '../../test/fakeSheets';
import { rosterView, teamView, adminRosterView } from '../views';
import { SIGNUP_HEADERS } from '../../sheets/schema';

/**
 * The projections are an access-control boundary, so these tests are written
 * as "what may cross" rather than "what this function returns for this input".
 *
 * The load-bearing assertion in each group is the closed one: every field of a
 * `Signup` is either named as allowed on this view or asserted absent. A new
 * column on the Signups tab therefore cannot quietly join a payload — it
 * arrives as a failure here, where someone has to decide whether players, or
 * the organizer, may see it.
 */

const SESSION = '2099-01-01';

/** A row with every field populated distinctively, so a leak is recognisable. */
function loaded(over: Parameters<typeof makeSignup>[0] = {}) {
  return makeSignup({
    sessionId: SESSION,
    signupId: 'sid-1',
    email: 'player@dummy.test',
    fullName: 'Player One',
    gender: 'Female',
    memberStatus: 'guest',
    invitedByName: 'Inviter Ivy',
    willingToShare: true,
    pairId: '',
    status: 'confirmed',
    timestamp: '2099-01-01T00:00:00.000Z',
    positions: 'Catcher, SS',
    waiverAcceptedAt: '2099-01-01T00:00:00.000Z',
    waiverText: 'I accept all risks of playing softball.',
    paid: true,
    amountPaid: 17,
    paidAt: '2099-01-02T00:00:00.000Z',
    attended: true,
    subRequestTargetEmail: 'target@dummy.test',
    subRequestStatus: 'pending',
    subRequestedAt: '2099-01-03T00:00:00.000Z',
    teamName: 'Team 1',
    ...over,
  });
}

/**
 * Asserts the projection carries exactly `allowed` — no more, no less — and
 * that every other `Signup` field is absent.
 *
 * `allowed` may name derived fields too (`pairedWith` is not a column); what
 * makes this closed is the second half, which walks SIGNUP_HEADERS. A new
 * column on the Signups tab therefore fails here rather than joining a payload
 * unnoticed.
 */
function allowsExactly(projected: Record<string, unknown>, allowed: string[]) {
  expect(Object.keys(projected).sort()).toEqual([...allowed].sort());
  const forbidden = SIGNUP_HEADERS.filter((h) => !allowed.includes(h));
  for (const field of forbidden) expect(projected).not.toHaveProperty(field);
}

describe('rosterView', () => {
  it('shows a participant only names, positions and who they share with', () => {
    const view = rosterView([loaded()], 'player@dummy.test');

    expect(view.confirmed).toHaveLength(1);
    allowsExactly(view.confirmed![0] as unknown as Record<string, unknown>, ['fullName', 'positions', 'pairedWith']);
  });

  it('names the partner of a shared spot without exposing their row', () => {
    const a = loaded({ signupId: 'a', email: 'a@dummy.test', fullName: 'A', pairId: 'p1' });
    const b = loaded({ signupId: 'b', email: 'b@dummy.test', fullName: 'B', pairId: 'p1' });

    const view = rosterView([a, b], 'a@dummy.test');

    expect(view.confirmed!.find((e) => e.fullName === 'A')?.pairedWith).toBe('B');
  });

  it('hides names from a signed-in viewer with no signup, but still counts them', () => {
    const view = rosterView([loaded()], 'outsider@dummy.test');

    expect(view.confirmedCount).toBe(1);
    expect(view.confirmed).toBeNull();
    expect(view.waitlisted).toBeNull();
  });

  it('never returns an email address, even to a participant', () => {
    const view = rosterView([loaded()], 'player@dummy.test');

    expect(JSON.stringify(view)).not.toMatch(/dummy\.test/);
  });

  it('orders the waitlist by signup time', () => {
    const later = loaded({ signupId: 'l', email: 'l@dummy.test', fullName: 'Later', status: 'waitlisted', timestamp: '2099-01-05T00:00:00.000Z' });
    const earlier = loaded({ signupId: 'e', email: 'e@dummy.test', fullName: 'Earlier', status: 'waitlisted', timestamp: '2099-01-04T00:00:00.000Z' });

    const view = rosterView([later, earlier, loaded()], 'player@dummy.test');

    expect(view.waitlisted!.map((e) => e.fullName)).toEqual(['Earlier', 'Later']);
  });
});

describe('teamView', () => {
  it('shows a teammate only their name, gender, positions and shared-spot id', () => {
    const [teamOne] = teamView([loaded()], 2);

    allowsExactly(teamOne.members[0] as unknown as Record<string, unknown>, [
      'signupId',
      'fullName',
      'gender',
      'positions',
      'pairId',
    ]);
  });

  it('never returns an email address, a payment or a waiver', () => {
    const serialized = JSON.stringify(teamView([loaded()], 2));

    expect(serialized).not.toMatch(/dummy\.test/);
    expect(serialized).not.toMatch(/I accept all risks/);
    expect(serialized).not.toMatch(/Inviter Ivy/);
  });

  it('drops someone who cancelled after teams were posted, so the team plays short', () => {
    const a = loaded({ signupId: 'a', email: 'a@dummy.test', teamName: 'Team 1' });
    const b = loaded({ signupId: 'b', email: 'b@dummy.test', teamName: 'Team 1', status: 'cancelled' });

    const [teamOne] = teamView([a, b], 2);

    expect(teamOne.members.map((m) => m.signupId)).toEqual(['a']);
  });

  it('keeps enough to report what a team cannot cover', () => {
    const catcher = loaded({ signupId: 'c', email: 'c@dummy.test', positions: 'Catcher', teamName: 'Team 1' });

    const [teamOne] = teamView([catcher], 2);

    // One catcher against a nine-slot lineup: short eight, and Catcher covered.
    expect(teamOne.deficiency).toBe(8);
    expect(teamOne.missing).not.toContain('Catcher');
  });
});

describe('adminRosterView', () => {
  it('carries what the console renders and what payments and audiences read', () => {
    const [entry] = adminRosterView([loaded()]);

    allowsExactly(entry as unknown as Record<string, unknown>, [
      'signupId',
      'email',
      'fullName',
      'memberStatus',
      'invitedByName',
      'pairId',
      'status',
      'positions',
      'paid',
      'amountPaid',
      'attended',
    ]);
  });

  it('leaves the waiver and the sub-request internals out of the payload', () => {
    const serialized = JSON.stringify(adminRosterView([loaded()]));

    expect(serialized).not.toMatch(/I accept all risks/);
    expect(serialized).not.toMatch(/target@dummy\.test/);
  });

  it('keeps cancelled rows, which the organizer needs and players never see', () => {
    const rows = adminRosterView([loaded({ status: 'cancelled' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('cancelled');
  });

  it('preserves sheet order, which the per-person grouping depends on', () => {
    const rows = adminRosterView([
      loaded({ signupId: 'first', email: 'a@dummy.test' }),
      loaded({ signupId: 'second', email: 'b@dummy.test' }),
      loaded({ signupId: 'third', email: 'c@dummy.test' }),
    ]);

    expect(rows.map((r) => r.signupId)).toEqual(['first', 'second', 'third']);
  });
});
