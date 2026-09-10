'use client';

import { CalendarPlus } from 'lucide-react';
import { zonedTimeToUtc } from '../lib/time';
import { formatLocation } from '../lib/location';
import { toCalendarStamp } from '../lib/icalendar';

interface AddToCalendarProps {
  gameDate: string;
  gameTime: string;
  locationArea: string;
  locationName: string;
  locationUrl: string;
}

const GAME_LENGTH_HOURS = 2;

/**
 * "Add to calendar" for a confirmed player. Offers Google Calendar (most
 * people here are already signed in with Google) and a plain .ics download for
 * everyone else.
 *
 * Worth having because the game date can move — an admin can reschedule a
 * session, including to a different day of the weekend — and because the
 * calendar entry carries the location, which is the detail people actually
 * need on the day.
 */
export function AddToCalendar({ gameDate, gameTime, locationArea, locationName, locationUrl }: AddToCalendarProps) {
  const start = zonedTimeToUtc(gameDate, gameTime);
  const end = new Date(start.getTime() + GAME_LENGTH_HOURS * 60 * 60 * 1000);
  const title = 'Softball Scrimmage';
  const location = formatLocation({ area: locationArea, name: locationName, url: locationUrl });
  const description = locationUrl ? `Field: ${locationUrl}` : '';

  const googleUrl =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${toCalendarStamp(start)}/${toCalendarStamp(end)}` +
    (location ? `&location=${encodeURIComponent(location)}` : '') +
    (description ? `&details=${encodeURIComponent(description)}` : '');

  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
      <CalendarPlus className="h-3.5 w-3.5 shrink-0" />
      Add to
      <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
        Google Calendar
      </a>
      <span aria-hidden="true">·</span>
      <a href="/api/calendar" download={`softball-${gameDate}.ics`} className="text-blue-600 hover:underline">
        .ics
      </a>
    </p>
  );
}
