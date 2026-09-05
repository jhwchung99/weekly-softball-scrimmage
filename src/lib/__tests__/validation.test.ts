import { describe, it, expect } from 'vitest';
import {
  validateFullName,
  validateGender,
  validateAge,
  validateSavedPositions,
  validateInvitedByName,
  validateEmail,
  validateCost,
  validateCapacity,
  validateGameDate,
  validateGameTime,
  validatePlayerProfile,
} from '../validation';

describe('validateFullName / validateGender / validateInvitedByName', () => {
  it('trims and accepts a normal value', () => {
    expect(validateFullName('  Jane Doe  ')).toBe('Jane Doe');
  });

  it('rejects empty or whitespace-only input', () => {
    expect(() => validateFullName('')).toThrow(/required/);
    expect(() => validateFullName('   ')).toThrow(/required/);
  });

  it('rejects a name over 100 characters', () => {
    expect(() => validateFullName('a'.repeat(101))).toThrow(/100 characters/);
  });

  it('accepts a formula-like value — RAW writes make this safe (see security hardening plan)', () => {
    expect(validateFullName('=1+1')).toBe('=1+1');
  });

  it('rejects an overlong gender', () => {
    expect(() => validateGender('a'.repeat(31))).toThrow(/30 characters/);
  });

  it('rejects an empty invitedByName', () => {
    expect(() => validateInvitedByName('  ')).toThrow(/required/);
  });
});

describe('validateAge', () => {
  it('accepts values within range', () => {
    expect(validateAge(1)).toBe(1);
    expect(validateAge(120)).toBe(120);
    expect(validateAge('42')).toBe(42);
  });

  it('rejects below the minimum', () => {
    expect(() => validateAge(0)).toThrow(/between 1 and 120/);
  });

  it('rejects above the maximum', () => {
    expect(() => validateAge(121)).toThrow(/between 1 and 120/);
  });

  it('rejects non-integer values', () => {
    expect(() => validateAge(25.5)).toThrow(/whole number/);
  });

  it('rejects non-numeric input', () => {
    expect(() => validateAge('not a number')).toThrow(/whole number/);
  });
});

describe('validateSavedPositions', () => {
  it('allows an empty value (declaring positions is optional)', () => {
    expect(validateSavedPositions('')).toBe('');
    expect(validateSavedPositions(undefined)).toBe('');
  });

  it('accepts a comma-separated list of known positions', () => {
    expect(validateSavedPositions('Catcher, SS,  Outfield ')).toBe('Catcher, SS, Outfield');
  });

  it('rejects an unknown position', () => {
    expect(() => validateSavedPositions('Catcher, Quarterback')).toThrow(/Quarterback/);
  });
});

describe('validateEmail', () => {
  it('trims and accepts a valid-looking email', () => {
    expect(validateEmail('  a@example.com  ')).toBe('a@example.com');
  });

  it('rejects a missing @ or domain', () => {
    expect(() => validateEmail('not-an-email')).toThrow(/valid email/);
    expect(() => validateEmail('a@b')).toThrow(/valid email/);
  });

  it('rejects empty input', () => {
    expect(() => validateEmail('')).toThrow(/valid email/);
  });
});

describe('validateCost', () => {
  it('accepts a non-negative number', () => {
    expect(validateCost(0)).toBe(0);
    expect(validateCost('12.5')).toBe(12.5);
  });

  it('rejects a negative number', () => {
    expect(() => validateCost(-1)).toThrow(/non-negative/);
  });

  it('rejects non-finite input', () => {
    expect(() => validateCost('not a number')).toThrow(/non-negative/);
  });
});

describe('validateCapacity', () => {
  it('accepts a non-negative number', () => {
    expect(validateCapacity(0)).toBe(0);
    expect(validateCapacity('20')).toBe(20);
  });

  it('rejects a negative number', () => {
    expect(() => validateCapacity(-1)).toThrow(/non-negative/);
  });

  it('rejects non-finite input', () => {
    expect(() => validateCapacity('not a number')).toThrow(/non-negative/);
  });
});

describe('validateGameDate', () => {
  it('accepts a Friday, Saturday, or Sunday', () => {
    expect(validateGameDate('2026-07-10')).toBe('2026-07-10'); // Friday
    expect(validateGameDate('2026-07-11')).toBe('2026-07-11'); // Saturday
    expect(validateGameDate('2026-07-12')).toBe('2026-07-12'); // Sunday
  });

  it('rejects a Monday-through-Thursday date', () => {
    expect(() => validateGameDate('2026-07-06')).toThrow(/Friday, Saturday, or Sunday/); // Monday
    expect(() => validateGameDate('2026-07-09')).toThrow(/Friday, Saturday, or Sunday/); // Thursday
  });

  it('rejects a malformed date string', () => {
    expect(() => validateGameDate('07/10/2026')).toThrow(/ISO date/);
    expect(() => validateGameDate('')).toThrow(/ISO date/);
  });

  it('rejects a date that does not really exist', () => {
    expect(() => validateGameDate('2026-02-30')).toThrow(/real calendar date/);
  });
});

describe('validateGameTime', () => {
  it('accepts a valid 24-hour time', () => {
    expect(validateGameTime('18:00')).toBe('18:00');
    expect(validateGameTime('09:05')).toBe('09:05');
  });

  it('rejects an out-of-range or malformed time', () => {
    expect(() => validateGameTime('24:00')).toThrow(/HH:MM/);
    expect(() => validateGameTime('6:00 PM')).toThrow(/HH:MM/);
    expect(() => validateGameTime('')).toThrow(/HH:MM/);
  });
});

describe('validatePlayerProfile', () => {
  it('validates every field together and returns a clean object', () => {
    const result = validatePlayerProfile({ fullName: ' A ', gender: ' M ', age: '25', savedPositions: 'Catcher' });
    expect(result).toEqual({ fullName: 'A', gender: 'M', age: 25, savedPositions: 'Catcher' });
  });

  it('propagates the first validation failure', () => {
    expect(() => validatePlayerProfile({ fullName: '', gender: 'M', age: 25 })).toThrow(/fullName/);
  });
});
