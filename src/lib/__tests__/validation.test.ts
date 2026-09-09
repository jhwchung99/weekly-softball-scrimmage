import { describe, it, expect } from 'vitest';
import {
  validateFullName,
  validateAnnouncementNote,
  validateGender,
  validateSavedPositions,
  validateInvitedByName,
  validateEmail,
  validateCost,
  validateCapacity,
  validateGameDate,
  validateGameTime,
  validatePlayerProfile,
  validateFeedback,
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

  it('accepts the two offered genders', () => {
    expect(validateGender('  Male  ')).toBe('Male');
    expect(validateGender('Female')).toBe('Female');
  });

  it('normalizes casing, so a row typed back when this was free text still resolves', () => {
    expect(validateGender('male')).toBe('Male');
    expect(validateGender('FEMALE')).toBe('Female');
  });

  it('rejects anything outside the list', () => {
    expect(() => validateGender('Other')).toThrow(/must be one of/);
    expect(() => validateGender('M')).toThrow(/must be one of/);
    expect(() => validateGender('  ')).toThrow(/required/);
  });

  it('rejects an empty invitedByName', () => {
    expect(() => validateInvitedByName('  ')).toThrow(/required/);
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
    const result = validatePlayerProfile({ fullName: ' A ', gender: ' male ', savedPositions: 'Catcher' });
    expect(result).toEqual({ fullName: 'A', gender: 'Male', savedPositions: 'Catcher' });
  });

  it('propagates the first validation failure', () => {
    expect(() => validatePlayerProfile({ fullName: '', gender: 'Male' })).toThrow(/fullName/);
  });
});

describe('validateFeedback', () => {
  it('accepts a well-formed report', () => {
    expect(validateFeedback({ kind: 'bug', message: '  Cancel does nothing.  ', pageUrl: '/' })).toEqual({
      kind: 'bug',
      message: 'Cancel does nothing.',
      pageUrl: '/',
    });
  });

  it('rejects a kind that is not one of the two offered', () => {
    expect(() => validateFeedback({ kind: 'complaint', message: 'x' })).toThrow(/kind must be one of/);
    expect(() => validateFeedback({ message: 'x' })).toThrow(/kind must be one of/);
  });

  it('requires a non-empty message', () => {
    expect(() => validateFeedback({ kind: 'bug', message: '   ' })).toThrow(/message is required/);
  });

  it('caps the message so a notification stays readable', () => {
    expect(() => validateFeedback({ kind: 'bug', message: 'x'.repeat(1001) })).toThrow(/1000 characters or fewer/);
  });

  it('drops a pageUrl that is not a same-site path', () => {
    // The organizer may well tap this in a notification, so an absolute URL
    // from the request body must never survive into the push.
    expect(validateFeedback({ kind: 'bug', message: 'x', pageUrl: 'https://evil.example/' }).pageUrl).toBe('');
    expect(validateFeedback({ kind: 'bug', message: 'x', pageUrl: 'javascript:alert(1)' }).pageUrl).toBe('');
    // Protocol-relative: starts with '/', but a browser resolves it to
    // https://evil.example, so it must not survive either.
    expect(validateFeedback({ kind: 'bug', message: 'x', pageUrl: '//evil.example/' }).pageUrl).toBe('');
    expect(validateFeedback({ kind: 'bug', message: 'x', pageUrl: 42 }).pageUrl).toBe('');
  });

  it('keeps a same-site path', () => {
    expect(validateFeedback({ kind: 'feedback', message: 'x', pageUrl: '/guidelines' }).pageUrl).toBe('/guidelines');
  });
});

describe('validateAnnouncementNote', () => {
  it('treats an absent or blank note as no note, since the email stands without one', () => {
    expect(validateAnnouncementNote(undefined)).toBe('');
    expect(validateAnnouncementNote('   ')).toBe('');
    expect(validateAnnouncementNote(42)).toBe('');
  });

  it('trims but otherwise keeps what the organizer wrote', () => {
    // Including a link: this goes into a plain-text email body written by an
    // admin, not a header or a tappable push, so there is nothing to escape.
    expect(validateAnnouncementNote('  Moved to https://maps.app.goo.gl/x  ')).toBe('Moved to https://maps.app.goo.gl/x');
  });

  it('caps the length so it stays a note rather than a newsletter', () => {
    expect(() => validateAnnouncementNote('x'.repeat(501))).toThrow(/500 characters or fewer/);
  });
});
