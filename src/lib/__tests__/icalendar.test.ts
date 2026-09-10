import { describe, it, expect } from 'vitest';
import { escapeText, foldLine, buildCalendarFile } from '../icalendar';

/**
 * The .ics had no tests at all, and the bug it carried was invisible without
 * one: `formatLocation` puts a comma in the location whenever both the field
 * and the area are known, and a comma separates values in an iCalendar TEXT
 * property.
 */

describe('escapeText', () => {
  it('escapes the comma that formatLocation always produces', () => {
    // "Iceland Diamond 3, Mississauga" read as two values shows the field and
    // drops the city — the half a player is less likely to already know.
    expect(escapeText('Iceland Diamond 3, Mississauga')).toBe('Iceland Diamond 3\\, Mississauga');
  });

  it('escapes semicolons, the other value separator', () => {
    expect(escapeText('Field 3; gate B')).toBe('Field 3\\; gate B');
  });

  it('escapes backslashes first, so the escapes are not escaped again', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
    expect(escapeText('a\\,b')).toBe('a\\\\\\,b');
  });

  it('turns newlines into the two-character sequence, since a real one ends the property', () => {
    expect(escapeText('line one\nline two')).toBe('line one\\nline two');
    expect(escapeText('crlf\r\nhere')).toBe('crlf\\nhere');
  });

  it('leaves an ordinary value alone', () => {
    expect(escapeText('Softball Scrimmage')).toBe('Softball Scrimmage');
  });
});

describe('foldLine', () => {
  it('leaves a line inside the limit alone', () => {
    expect(foldLine('SUMMARY:Softball Scrimmage')).toBe('SUMMARY:Softball Scrimmage');
  });

  it('folds a long line, continuing with a space', () => {
    const folded = foldLine('LOCATION:' + 'x'.repeat(100));
    const [first, ...rest] = folded.split('\r\n');

    expect(first).toHaveLength(75);
    expect(rest.every((line) => line.startsWith(' '))).toBe(true);
    // Unfolding puts it back exactly.
    expect(folded.replace(/\r\n /g, '')).toBe('LOCATION:' + 'x'.repeat(100));
  });

  it('measures octets, not characters', () => {
    // The limit is on encoded bytes, so an accented name counts for more than
    // its length and a naive fold would produce over-long lines.
    const folded = foldLine('LOCATION:' + 'é'.repeat(50));
    const octets = (s: string) => new TextEncoder().encode(s).length;

    expect(folded.split('\r\n').every((line) => octets(line) <= 75)).toBe(true);
  });

  it('never splits a character across a fold', () => {
    const folded = foldLine('LOCATION:' + 'é'.repeat(50));

    expect(folded).not.toContain('�');
    expect(folded.replace(/\r\n /g, '')).toBe('LOCATION:' + 'é'.repeat(50));
  });
});

describe('buildCalendarFile', () => {
  const event = {
    uid: '2026-07-10-softball@example.test',
    start: new Date('2026-07-10T22:00:00.000Z'),
    end: new Date('2026-07-11T00:00:00.000Z'),
    summary: 'Softball Scrimmage',
    location: 'Iceland Diamond 3, Mississauga',
    description: 'Field: https://maps.example.test/x',
    stamp: new Date('2026-07-01T00:00:00.000Z'),
  };

  it('produces the whole file, escaped, with CRLF endings', () => {
    expect(buildCalendarFile(event)).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Weekly Softball Scrimmage//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:2026-07-10-softball@example.test',
        'DTSTAMP:20260701T000000Z',
        'DTSTART:20260710T220000Z',
        'DTEND:20260711T000000Z',
        'SUMMARY:Softball Scrimmage',
        'LOCATION:Iceland Diamond 3\\, Mississauga',
        'DESCRIPTION:Field: https://maps.example.test/x',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    );
  });

  it('omits a location that has not been decided yet', () => {
    // Monday, before the field is booked: an empty LOCATION line is worse
    // than none, because some clients render it as a blank place.
    const file = buildCalendarFile({ ...event, location: '', description: '' });

    expect(file).not.toContain('LOCATION');
    expect(file).not.toContain('DESCRIPTION');
  });
});
