import { describe, it, expect } from 'vitest';
import {
  validateAnnouncementNote,
  validateInvitedByName,
  validateEmail,
  validatePlayerProfile,
  validateFeedback,
  validateSessionEdit,
  validateSessionCreate,
  validateSignupOverride,
  validateReschedule,
} from '../validation';

/**
 * The leaf checks are private now, so they are exercised through the composer
 * that actually uses them — which is the surface a route has, and therefore
 * the surface worth pinning. The rules themselves are unchanged: what moved is
 * who may call them.
 */

const CREATE_DEFAULTS = { gameTime: '18:00', capacity: 12, pricePerSpot: 10 };

describe('names and genders, via validatePlayerProfile', () => {
  const profile = (over: Record<string, unknown> = {}) =>
    validatePlayerProfile({ fullName: 'Jane Doe', gender: 'Female', ...over });

  it('trims and accepts a normal name', () => {
    expect(profile({ fullName: '  Jane Doe  ' }).fullName).toBe('Jane Doe');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(() => profile({ fullName: '' })).toThrow(/required/);
    expect(() => profile({ fullName: '   ' })).toThrow(/required/);
  });

  it('rejects a name over 100 characters', () => {
    expect(() => profile({ fullName: 'a'.repeat(101) })).toThrow(/100 characters/);
  });

  it('accepts a formula-like value — RAW writes make this safe (see security hardening plan)', () => {
    expect(profile({ fullName: '=1+1' }).fullName).toBe('=1+1');
  });

  it('accepts the two offered genders', () => {
    expect(profile({ gender: '  Male  ' }).gender).toBe('Male');
    expect(profile({ gender: 'Female' }).gender).toBe('Female');
  });

  it('normalizes casing, so a row typed back when this was free text still resolves', () => {
    expect(profile({ gender: 'male' }).gender).toBe('Male');
    expect(profile({ gender: 'FEMALE' }).gender).toBe('Female');
  });

  it('rejects a gender outside the list', () => {
    expect(() => profile({ gender: 'Other' })).toThrow(/must be one of/);
    expect(() => profile({ gender: '  ' })).toThrow(/required/);
  });

  it('rejects an empty invitedByName', () => {
    expect(() => validateInvitedByName('  ')).toThrow(/required/);
  });
});

describe('saved positions, via validatePlayerProfile', () => {
  const positions = (value: unknown) =>
    validatePlayerProfile({ fullName: 'Jane Doe', gender: 'Female', savedPositions: value }).savedPositions;

  it('allows an empty value (declaring positions is optional)', () => {
    expect(positions('')).toBe('');
    expect(positions(undefined)).toBe('');
  });

  it('accepts a comma-separated list of known positions', () => {
    expect(positions('Catcher, SS,  Outfield ')).toBe('Catcher, SS, Outfield');
  });

  it('rejects an unknown position', () => {
    expect(() => positions('Catcher, Quarterback')).toThrow(/Quarterback/);
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

describe('money and capacity, via the session composers', () => {
  it('accepts a non-negative cost', () => {
    expect(validateSessionEdit({ cost: 0 }).updates.cost).toBe(0);
    expect(validateSessionEdit({ cost: '12.5' }).updates.cost).toBe(12.5);
  });

  it('rejects a negative or non-numeric cost', () => {
    expect(() => validateSessionEdit({ cost: -1 })).toThrow(/non-negative/);
    expect(() => validateSessionEdit({ cost: 'not a number' })).toThrow(/non-negative/);
  });

  it('accepts a non-negative capacity', () => {
    expect(validateSessionEdit({ capacity: 0 }).updates.capacity).toBe(0);
    expect(validateSessionEdit({ capacity: '20' }).updates.capacity).toBe(20);
  });

  it('rejects a negative or non-numeric capacity', () => {
    expect(() => validateSessionEdit({ capacity: -1 })).toThrow(/non-negative/);
    expect(() => validateSessionEdit({ capacity: 'not a number' })).toThrow(/non-negative/);
  });

  it('accepts one or two fields, and nothing else', () => {
    expect(validateSessionEdit({ numFields: 2 }).updates.numFields).toBe(2);
    expect(() => validateSessionEdit({ numFields: 3 })).toThrow(/1 or 2/);
    expect(() => validateSessionEdit({ numFields: 0 })).toThrow(/1 or 2/);
  });

  it('rejects a negative amount on a signup override', () => {
    expect(() => validateSignupOverride({ amountPaid: -5 })).toThrow(/non-negative/);
  });
});

describe('game dates and times, via validateReschedule', () => {
  const on = (date: string) => validateReschedule(date, '18:00').gameDate;

  it('accepts a Friday, Saturday, or Sunday', () => {
    expect(on('2026-07-10')).toBe('2026-07-10'); // Friday
    expect(on('2026-07-11')).toBe('2026-07-11'); // Saturday
    expect(on('2026-07-12')).toBe('2026-07-12'); // Sunday
  });

  it('rejects a Monday-through-Thursday date', () => {
    expect(() => on('2026-07-06')).toThrow(/Friday, Saturday, or Sunday/); // Monday
    expect(() => on('2026-07-09')).toThrow(/Friday, Saturday, or Sunday/); // Thursday
  });

  it('rejects a malformed date string', () => {
    expect(() => on('07/10/2026')).toThrow(/ISO date/);
    expect(() => on('')).toThrow(/ISO date/);
  });

  it('rejects a date that does not really exist', () => {
    expect(() => on('2026-02-30')).toThrow(/real calendar date/);
  });

  it('accepts a valid 24-hour time', () => {
    expect(validateReschedule('2026-07-10', '18:00').gameTime).toBe('18:00');
    expect(validateReschedule('2026-07-10', '09:05').gameTime).toBe('09:05');
  });

  it('rejects an out-of-range or malformed time', () => {
    expect(() => validateReschedule('2026-07-10', '24:00')).toThrow(/HH:MM/);
    expect(() => validateReschedule('2026-07-10', '6:00 PM')).toThrow(/HH:MM/);
    expect(() => validateReschedule('2026-07-10', '')).toThrow(/HH:MM/);
  });
});

describe('location, via validateSessionEdit', () => {
  it('accepts an http or https map link', () => {
    expect(validateSessionEdit({ locationUrl: 'https://maps.example/x' }).updates.locationUrl).toBe(
      'https://maps.example/x'
    );
  });

  it('refuses a javascript: URL, which would run for every player viewing the page', () => {
    // This value is rendered as an anchor href, so the scheme check is a real
    // defence rather than tidiness.
    expect(() => validateSessionEdit({ locationUrl: 'javascript:alert(1)' })).toThrow(/http/);
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => validateSessionEdit({ locationUrl: 'not a url' })).toThrow(/valid URL/);
  });

  it('allows clearing the link', () => {
    expect(validateSessionEdit({ locationUrl: '' }).updates.locationUrl).toBe('');
  });

  it('caps an over-long area or field name', () => {
    expect(() => validateSessionEdit({ locationArea: 'a'.repeat(121) })).toThrow(/120 characters/);
    expect(() => validateSessionEdit({ locationName: 'a'.repeat(121) })).toThrow(/120 characters/);
  });
});

/**
 * The part that was assembled by hand in each route and tested nowhere: which
 * fields a request actually supplied. Getting this wrong is how a partial
 * update silently writes a field nobody sent.
 */
describe('validateSessionEdit — which fields were provided', () => {
  it('carries only the fields the request named', () => {
    const { updates } = validateSessionEdit({ capacity: 15 });

    expect(updates).toEqual({ capacity: 15 });
  });

  it('does not invent a field that was left out', () => {
    const { updates } = validateSessionEdit({ capacity: 15 });

    expect(updates).not.toHaveProperty('cost');
    expect(updates).not.toHaveProperty('status');
    expect(updates).not.toHaveProperty('locationName');
  });

  it('keeps a field that was explicitly set to a falsy value', () => {
    // Zero and empty string are real edits — "not provided" is undefined only.
    const { updates } = validateSessionEdit({ capacity: 0, locationName: '' });

    expect(updates.capacity).toBe(0);
    expect(updates.locationName).toBe('');
  });

  it('separates a reschedule from the field updates', () => {
    const revision = validateSessionEdit({ gameDate: '2026-07-11', gameTime: '20:00', capacity: 15 });

    expect(revision.gameDate).toBe('2026-07-11');
    expect(revision.gameTime).toBe('20:00');
    expect(revision.updates).toEqual({ capacity: 15 });
  });

  it('leaves the half of a reschedule that was not supplied undefined', () => {
    const revision = validateSessionEdit({ gameTime: '20:00' });

    expect(revision.gameDate).toBeUndefined();
    expect(revision.gameTime).toBe('20:00');
  });

  it('rejects a request that names no editable field', () => {
    expect(() => validateSessionEdit({})).toThrow(/Provide at least one of/);
    expect(() => validateSessionEdit({ nonsense: 1 })).toThrow(/Provide at least one of/);
    expect(() => validateSessionEdit(undefined)).toThrow(/Provide at least one of/);
  });

  it('accepts each of the three session statuses and nothing else', () => {
    for (const status of ['open', 'closed', 'cancelled'] as const) {
      expect(validateSessionEdit({ status }).updates.status).toBe(status);
    }
    expect(() => validateSessionEdit({ status: 'paused' })).toThrow(/must be one of/);
  });
});

describe('validateSignupOverride — which fields were provided', () => {
  it('carries only what the request named', () => {
    expect(validateSignupOverride({ attended: true })).toEqual({ attended: true });
  });

  it('keeps an explicit false, which is a real edit', () => {
    // Un-ticking "paid" clears the record; it must not read as "not provided".
    expect(validateSignupOverride({ paid: false })).toEqual({ paid: false });
  });

  it('accepts each signup status and nothing else', () => {
    for (const status of ['confirmed', 'waitlisted', 'cancelled'] as const) {
      expect(validateSignupOverride({ status }).status).toBe(status);
    }
    expect(() => validateSignupOverride({ status: 'paused' })).toThrow(/must be one of/);
  });

  it('rejects a request that names no field', () => {
    expect(() => validateSignupOverride({})).toThrow(/Provide at least one of/);
  });
});

describe('validateSessionCreate', () => {
  it('falls back to the league defaults for everything but the date', () => {
    expect(validateSessionCreate({ gameDate: '2026-07-10' }, CREATE_DEFAULTS)).toEqual({
      gameDate: '2026-07-10',
      gameTime: '18:00',
      capacity: 12,
      cost: 0,
      pricePerSpot: 10,
      locationArea: '',
    });
  });

  it('takes what was supplied over the defaults', () => {
    const created = validateSessionCreate(
      { gameDate: '2026-07-10', gameTime: '19:30', capacity: 20, locationArea: 'Mississauga' },
      CREATE_DEFAULTS
    );

    expect(created).toMatchObject({ gameTime: '19:30', capacity: 20, locationArea: 'Mississauga' });
  });

  it('still requires a valid game date', () => {
    expect(() => validateSessionCreate({ gameDate: '2026-07-06' }, CREATE_DEFAULTS)).toThrow(/Friday/);
    expect(() => validateSessionCreate({}, CREATE_DEFAULTS)).toThrow(/ISO date/);
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
