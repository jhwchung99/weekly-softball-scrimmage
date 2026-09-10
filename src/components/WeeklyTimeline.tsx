'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, CalendarX2, Flag } from 'lucide-react';
import { getWeeklyMilestones } from '../lib/time';
import { Card } from './Card';
import type { SessionStatus } from '../sheets/schema';
import { hasRegistrationClosed, hasGameStarted, isRosterLocked, type SessionPhase } from '../lib/sessionPhase';

interface WeeklyTimelineProps {
  gameDate: string;
  gameTime: string;
  status: SessionStatus;
  /**
   * Where the week stands, from the server. The marks used to be decided by
   * comparing the milestones to this browser's clock, which made the answer a
   * property of the viewer's device rather than of the session. Null only
   * before the first load resolves, which reads as "nothing has happened yet".
   */
  phase: SessionPhase | null;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(d: Date): string {
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

/** "in 2 days", "in 3 hours", "in 5 minutes" — coarse on purpose, this
 * is a status hint, not a precise countdown. */
function formatRelative(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * A dot is a *moment* (registration opened; it closed; the game started),
 * so it only has two readings: it has happened, or it hasn't.
 *
 * "In progress" is never true of a moment — it's true of the stretch
 * between two of them, which is what the connecting lines are for. Giving
 * dots a third, amber "current" look put that amber on the *next* dot,
 * which read as "Registration Closes is happening now" when the truth was
 * "registration is open and closing later".
 */
type DotState = 'done' | 'upcoming';

const DOT_STYLES: Record<DotState, string> = {
  done: 'bg-green-500',
  // Hollow rather than filled grey: an empty ring reads as "not yet",
  // where a filled dot reads as a state of its own.
  upcoming: 'bg-white ring-2 ring-slate-300',
};

/** A line is a *period*, so it gets the three-way reading. */
type LineState = 'done' | 'active' | 'upcoming';

const LINE_STYLES: Record<LineState, string> = {
  done: 'bg-green-500',
  active: 'bg-amber-400',
  upcoming: 'bg-slate-200',
};

function Dot({ state }: { state: DotState }) {
  return <div className={`h-3 w-3 shrink-0 rounded-full ${DOT_STYLES[state]}`} />;
}

function Line({ state }: { state: LineState }) {
  return <div className={`mt-[5px] h-0.5 flex-1 ${LINE_STYLES[state]}`} />;
}

/**
 * A horizontal stepper for the week's schedule — Registration Opens,
 * Registration Closes, Game Day — so a player can see at a glance where
 * the week stands without hunting for the information. The *dates*
 * shown, the marks, and the status line all come from the same computed
 * schedule (see getWeeklyMilestones), so they can't contradict each other.
 * Green means a moment has passed; amber on a line means that stretch of
 * the week is the one you're in. `status` only decides whether this renders
 * at all (a cancelled session shows nothing).
 */
export function WeeklyTimeline({ gameDate, gameTime, status, phase }: WeeklyTimelineProps) {
  // Re-render once a minute so "closes in 2 days" doesn't go stale on a
  // long-open tab, without needing a literal ticking clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (status === 'cancelled') return null;

  const now = new Date();
  // The printed dates are pure arithmetic on the game date — no clock involved,
  // so they are still computed here. Only the *comparisons* moved to the server.
  const { registrationOpensAt, registrationClosesAt, gameStart, cutoffStart } = getWeeklyMilestones(gameDate, gameTime);

  // Which marks are filled comes from the server's phase, so every viewer sees
  // the same week whatever their device thinks the time is. It remains the
  // same schedule the signup gate enforces (see signupFlow), so an admin
  // flipping a session open early still cannot make this claim registration is
  // open when signups would be refused.
  const opened = phase !== null && phase !== 'before';
  const closed = phase !== null && hasRegistrationClosed(phase);
  const started = phase !== null && hasGameStarted(phase);

  const openState: DotState = opened ? 'done' : 'upcoming';
  const closeState: DotState = closed ? 'done' : 'upcoming';
  const gameState: DotState = started ? 'done' : 'upcoming';

  // Each line is the stretch leading up to the dot on its right.
  const registrationLine: LineState = closed ? 'done' : opened ? 'active' : 'upcoming';
  const preGameLine: LineState = started ? 'done' : closed ? 'active' : 'upcoming';

  // Ordered by phase rather than by `status`. The old chain tested
  // status === 'closed' before the not-yet-open case, and since a session
  // created ahead of its week sits at 'closed', a player looking on Sunday
  // was told "Game starts Friday" instead of when they could actually sign
  // up. The final branch was unreachable.
  let statusLine: string;
  if (started) {
    statusLine = "Today's game has started. See you on the field!";
  } else if (closed) {
    statusLine =
      phase !== null && isRosterLocked(phase)
        ? `Game starts ${formatRelative(gameStart, now)}. Cancellations now won't trigger an auto-replacement`
        : `Game starts ${formatDateTime(gameStart)} (${formatRelative(gameStart, now)})`;
  } else if (opened) {
    statusLine = `Registration closes ${formatDateTime(registrationClosesAt)} (${formatRelative(registrationClosesAt, now)})`;
  } else {
    statusLine = `Registration opens ${formatDateTime(registrationOpensAt)} (${formatRelative(registrationOpensAt, now)})`;
  }

  return (
    <Card className="mt-4">
      <div className="flex items-start gap-1">
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <Dot state={openState} />
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-900">
            <CalendarClock className="h-3.5 w-3.5" /> Registration Opens
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(registrationOpensAt)}</p>
        </div>
        <Line state={registrationLine} />
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <Dot state={closeState} />
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-900">
            <CalendarX2 className="h-3.5 w-3.5" /> Registration Closes
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(registrationClosesAt)}</p>
        </div>
        <Line state={preGameLine} />
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <Dot state={gameState} />
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-900">
            <Flag className="h-3.5 w-3.5" /> Game Day
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(gameStart)}</p>
          <p className="text-xs text-slate-400">Cutoff: {formatTime(cutoffStart)}</p>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-slate-700">{statusLine}</p>
    </Card>
  );
}
