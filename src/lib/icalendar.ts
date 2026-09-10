/**
 * Building an iCalendar file that strict parsers accept.
 *
 * The .ics was assembled inline as template strings, which is fine until a
 * value contains one of the characters the format reserves. `formatLocation`
 * produces "Iceland Diamond 3, Mississauga" whenever both the field and the
 * area are known — and a comma is a **value separator** in an iCalendar TEXT
 * property. Lenient parsers show the whole string; strict ones read a
 * two-valued LOCATION and show half of it, which is the half without the city.
 *
 * Two rules from RFC 5545, and they are the whole of this module:
 * escape the reserved characters in TEXT values (3.3.11), and fold lines
 * longer than 75 octets (3.1).
 */

/**
 * Escapes one TEXT value.
 *
 * Backslash first, or the escapes added below get escaped again. Newlines
 * become the two-character sequence `\n`, since a literal newline would end
 * the property.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds one content line to 75 octets, continuation lines beginning with a
 * space.
 *
 * Octets, not characters: the limit is on the encoded bytes, so an accented
 * name counts for more than its length. Multi-byte characters are never split
 * across a fold, because a half-character is not valid UTF-8 in either piece.
 */
export function foldLine(line: string): string {
  const MAX = 75;
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (bytes(line) <= MAX) return line;

  const out: string[] = [];
  let current = '';
  // A continuation line spends one of its octets on the leading space.
  let limit = MAX;

  for (const char of line) {
    if (bytes(current) + bytes(char) > limit) {
      out.push(current);
      current = '';
      limit = MAX - 1;
    }
    current += char;
  }
  out.push(current);

  return out.join('\r\n ');
}

/** YYYYMMDDTHHMMSSZ, which is what both .ics and Google Calendar expect. */
export function toCalendarStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  /** Injectable so a test can assert the whole file rather than most of it. */
  stamp?: Date;
}

/**
 * One event as a complete .ics file.
 *
 * CRLF throughout, because the format says so and some parsers enforce it.
 */
export function buildCalendarFile(event: CalendarEvent): string {
  const text = (name: string, value: string) => foldLine(`${name}:${escapeText(value)}`);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Weekly Softball Scrimmage//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    // UID and the stamps are not TEXT properties, so they are not escaped —
    // and nothing in them could need it.
    `UID:${event.uid}`,
    `DTSTAMP:${toCalendarStamp(event.stamp ?? new Date())}`,
    `DTSTART:${toCalendarStamp(event.start)}`,
    `DTEND:${toCalendarStamp(event.end)}`,
    text('SUMMARY', event.summary),
    event.location ? text('LOCATION', event.location) : '',
    event.description ? text('DESCRIPTION', event.description) : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}
