import { upcomingSessions } from '../../../lib/currentWeek';
import { buildCalendarFile } from '../../../lib/icalendar';
import { formatLocation } from '../../../lib/location';
import { zonedTimeToUtc } from '../../../lib/time';

/**
 * One game as a calendar file.
 *
 * A route rather than the `data:` URL the button used to carry, because iOS
 * Safari ignores the `download` attribute on `data:` URLs and renders the
 * file as text — the reader gets a screenful of BEGIN:VCALENDAR instead of an
 * event to add, and this audience is mostly on phones. Served with a real
 * `Content-Type` and `Content-Disposition`, every platform offers to add it.
 *
 * Costs no extra Sheets read in practice: it goes through the same cached
 * week as the homepage, which the reader has just loaded. Unauthenticated for
 * the same reason `/api/sessions/current` is — when and where the game is was
 * never private — and it is the cache, not an auth check, that keeps this from
 * being a way to spend the quota.
 *
 * Takes `?sessionId=` to say which game, since a week can hold more than one
 * and each is its own event. Without it, the soonest upcoming game — which is
 * what the single-session button always meant.
 */

const GAME_LENGTH_HOURS = 2;

export async function GET(request: Request) {
  const sessions = await upcomingSessions();
  const wanted = new URL(request.url).searchParams.get('sessionId');
  const session = wanted ? sessions.find((s) => s.sessionId === wanted) : sessions[0];

  if (!session) {
    return new Response(wanted ? 'No such game.' : 'No game is scheduled.', { status: 404 });
  }

  const start = zonedTimeToUtc(session.gameDate, session.gameTime);
  const ics = buildCalendarFile({
    uid: `${session.gameDate}-softball@nhf-weekly-softball-scrims.com`,
    start,
    end: new Date(start.getTime() + GAME_LENGTH_HOURS * 60 * 60 * 1000),
    // Named for what the week actually is. Someone who added the event on
    // Monday keeps the entry they already have; the file is regenerated on
    // each download, so a re-add after the format changes reads correctly.
    summary: session.format === 'practice' ? 'Softball BP/Practice' : 'Softball Scrimmage',
    location: formatLocation({
      area: session.locationArea,
      name: session.locationName,
      url: session.locationUrl,
    }),
    description: session.locationUrl ? `Field: ${session.locationUrl}` : '',
  });

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="softball-${session.gameDate}.ics"`,
      // The file changes when the organizer books a field, so it is not worth
      // caching beyond the read behind it.
      'Cache-Control': 'no-store',
    },
  });
}
