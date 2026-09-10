import { describe, it, expect } from 'vitest';
import {
  parseSessionRow,
  serializeSessionRow,
  parseSignupRow,
  serializeSignupRow,
  parsePlayerRow,
  serializePlayerRow,
  parseFeedbackRow,
  serializeFeedbackRow,
  Session,
  Signup,
  Player,
  Feedback,
  FEEDBACK_HEADERS,
  SESSION_HEADERS,
  SIGNUP_HEADERS,
  PLAYER_HEADERS,
  ADMIN_HEADERS,
  Admin,
} from '../schema';
import { makeSession, makeSignup, makePlayer } from '../../test/fakeSheets';

describe('Session row round-trip', () => {
  it('preserves every field through serialize -> parse', () => {
    const session: Session = {
      sessionId: '2026-07-10',
      gameDate: '2026-07-10',
      gameTime: '18:00',
      registrationOpensAt: '2026-07-06T13:00:00.000Z',
      registrationClosesAt: '2026-07-09T01:00:00.000Z',
      capacity: 20,
      status: 'open',
      cost: 12.5,
      pricePerSpot: 10,
      locationArea: 'Mississauga',
      locationName: 'Iceland Park Diamond 3',
      locationUrl: 'https://maps.example.com/iceland',
      numFields: 2,
      teamsStatus: 'posted',
    };
    expect(parseSessionRow(serializeSessionRow(session))).toEqual(session);
  });

  it('defaults a blank status to closed and blank cost/capacity to 0', () => {
    const parsed = parseSessionRow({
      sessionId: 'x',
      gameDate: 'x',
      gameTime: 'x',
      registrationOpensAt: '',
      registrationClosesAt: '',
      capacity: '',
      status: '',
      cost: '',
      pricePerSpot: '',
      locationArea: '',
      locationName: '',
      locationUrl: '',
      numFields: '',
      teamsStatus: '',
    });
    // Closed, not open: a blank cell is the absence of a decision, and for
    // "are signups accepted" the safe reading of silence is no.
    expect(parsed.status).toBe('closed');
    expect(parsed.capacity).toBe(0);
    expect(parsed.cost).toBe(0);
    // One field is the historical behaviour, so a blank cell has to mean that
    // rather than zero, which would ask the generator for no teams at all.
    expect(parsed.numFields).toBe(1);
    expect(parsed.teamsStatus).toBe('');
  });
});

describe('Signup row round-trip', () => {
  const signup: Signup = {
    signupId: 'id-1',
    sessionId: '2026-07-10',
    email: 'a@dummy.test',
    fullName: 'A Player',
    gender: 'Other',
    memberStatus: 'guest',
    invitedByName: 'B Player',
    willingToShare: true,
    pairId: 'pair-1',
    status: 'confirmed',
    timestamp: '2026-07-01T00:00:00.000Z',
    positions: 'Catcher, SS',
    waiverAcceptedAt: '2026-07-01T00:00:00.000Z',
    waiverText: 'I agree...',
    paid: true,
    amountPaid: 10,
    paidAt: '2026-07-02T00:00:00.000Z',
    attended: false,
    subRequestTargetEmail: '',
    subRequestStatus: '',
    subRequestedAt: '',
    teamName: 'Team 1',
  };

  it('preserves every field through serialize -> parse', () => {
    expect(parseSignupRow(serializeSignupRow(signup))).toEqual(signup);
  });

  it('round-trips willingToShare and paid as false correctly (not just truthy defaults)', () => {
    const falsy: Signup = { ...signup, willingToShare: false, paid: false };
    const roundTripped = parseSignupRow(serializeSignupRow(falsy));
    expect(roundTripped.willingToShare).toBe(false);
    expect(roundTripped.paid).toBe(false);
  });

  it('defaults blank status/memberStatus/subRequestStatus sensibly', () => {
    const parsed = parseSignupRow({
      ...serializeSignupRow(signup),
      status: '',
      memberStatus: '',
      subRequestStatus: '',
    });
    expect(parsed.status).toBe('waitlisted');
    expect(parsed.memberStatus).toBe('guest');
    expect(parsed.subRequestStatus).toBe('');
  });

  it('preserves a pending/declined subRequestStatus through the round-trip', () => {
    const pending = parseSignupRow(serializeSignupRow({ ...signup, subRequestStatus: 'pending', subRequestTargetEmail: 'x@dummy.test' }));
    expect(pending.subRequestStatus).toBe('pending');
    expect(pending.subRequestTargetEmail).toBe('x@dummy.test');
  });
});

describe('Player row round-trip', () => {
  it('preserves every field through serialize -> parse', () => {
    const player: Player = { email: 'a@dummy.test', fullName: 'A', gender: 'Other', savedPositions: 'Rover' };
    expect(parsePlayerRow(serializePlayerRow(player))).toEqual(player);
  });
});

describe('Feedback row round-trip', () => {
  const feedback: Feedback = {
    feedbackId: 'fb-1',
    submittedAt: '2026-09-07T14:30:00.000Z',
    kind: 'bug',
    email: 'jane@example.com',
    fullName: 'Jane Doe',
    message: 'The cancel button does nothing.',
    pageUrl: '/guidelines',
  };

  it('preserves every field through serialize -> parse', () => {
    expect(parseFeedbackRow(serializeFeedbackRow(feedback))).toEqual(feedback);
  });

  it('defaults a blank kind rather than producing an out-of-range value', () => {
    expect(parseFeedbackRow({ ...serializeFeedbackRow(feedback), kind: '' }).kind).toBe('feedback');
  });

  it('lists every field of Feedback, since columns are mapped by position', () => {
    // A field present on the interface but missing from FEEDBACK_HEADERS
    // would silently never be written. `satisfies` catches the reverse.
    expect([...FEEDBACK_HEADERS].sort()).toEqual(Object.keys(feedback).sort());
  });
});

/**
 * The same check the Feedback tab already had, for the other four.
 *
 * `as const satisfies readonly (keyof T)[]` checks that every header *is* a
 * key. It does not check that every key is a header, and columns here map by
 * **position** — so a field added to an interface and forgotten in its header
 * list compiles, never gets written, and reads back as `''` forever. That is
 * the direction that was unguarded on the tab most likely to gain a column.
 *
 * The fixtures are annotated with their interface, so tsc requires them to be
 * complete; `Object.keys` then makes that completeness observable at runtime.
 */
describe('header lists name every field of their row type', () => {
  it.each([
    ['Session', SESSION_HEADERS, makeSession()],
    ['Signup', SIGNUP_HEADERS, makeSignup()],
    ['Player', PLAYER_HEADERS, makePlayer()],
    ['Admin', ADMIN_HEADERS, { email: 'admin@dummy.test' } satisfies Admin],
  ])('%s', (_name, headers, row) => {
    expect([...headers].sort()).toEqual(Object.keys(row).sort());
  });
});
