import { describe, it, expect } from 'vitest';
import {
  parseSessionRow,
  serializeSessionRow,
  parseSignupRow,
  serializeSignupRow,
  parsePlayerRow,
  serializePlayerRow,
  Session,
  Signup,
  Player,
} from '../schema';

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
    };
    expect(parseSessionRow(serializeSessionRow(session))).toEqual(session);
  });

  it('defaults a blank status to open and blank cost/capacity to 0', () => {
    const parsed = parseSessionRow({
      sessionId: 'x',
      gameDate: 'x',
      gameTime: 'x',
      registrationOpensAt: '',
      registrationClosesAt: '',
      capacity: '',
      status: '',
      cost: '',
    });
    expect(parsed.status).toBe('open');
    expect(parsed.capacity).toBe(0);
    expect(parsed.cost).toBe(0);
  });
});

describe('Signup row round-trip', () => {
  const signup: Signup = {
    signupId: 'id-1',
    sessionId: '2026-07-10',
    email: 'a@dummy.test',
    fullName: 'A Player',
    gender: 'Other',
    age: 30,
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
    subRequestTargetEmail: '',
    subRequestStatus: '',
    subRequestedAt: '',
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
    const player: Player = { email: 'a@dummy.test', fullName: 'A', gender: 'Other', age: 22, savedPositions: 'Rover' };
    expect(parsePlayerRow(serializePlayerRow(player))).toEqual(player);
  });
});
