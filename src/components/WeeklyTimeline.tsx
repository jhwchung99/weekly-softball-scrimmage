'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, CalendarX2, Flag } from 'lucide-react';
import { getWeeklyMilestones } from '../lib/time';
import { Card } from './Card';

interface WeeklyTimelineProps {
  gameDate: string;
  gameTime: string;
  status: 'open' | 'closed' | 'cancelled';
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

type DotState = 'done' | 'current' | 'upcoming';

function Dot({ state }: { state: DotState }) {
  const color = state === 'upcoming' ? 'bg-slate-200' : 'bg-green-500';
  return <div className={`h-3 w-3 shrink-0 rounded-full ${color}`} />;
}

function Line({ filled }: { filled: boolean }) {
  return <div className={`mt-[5px] h-0.5 flex-1 ${filled ? 'bg-green-500' : 'bg-slate-200'}`} />;
}

/**
 * A horizontal stepper for the week's schedule — Registration Opens,
 * Registration Closes, Game Day — so a player can see at a glance where
 * the week stands without hunting for the information. The *dates*
 * shown are always the computed schedule (see getWeeklyMilestones); the
 * *current stage* is driven by the session's actual `status`, which is
 * the real source of truth for whether signups are accepted (an admin
 * can open/close early or late, which the computed schedule alone
 * wouldn't reflect). See planner/2026-09-05-visual-redesign-timeline-guidelines-plan.md.
 */
export function WeeklyTimeline({ gameDate, gameTime, status }: WeeklyTimelineProps) {
  // Re-render once a minute so "closes in 2 days" doesn't go stale on a
  // long-open tab, without needing a literal ticking clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (status === 'cancelled') return null;

  const now = new Date();
  const { registrationOpensAt, registrationClosesAt, gameStart, cutoffStart } = getWeeklyMilestones(gameDate, gameTime);

  const openDone = status === 'closed' || now >= registrationOpensAt;
  const closeDone = status === 'closed';
  const gameDone = now >= gameStart;

  const openState: DotState = openDone ? 'done' : 'current';
  const closeState: DotState = closeDone ? 'done' : status === 'open' ? 'current' : 'upcoming';
  const gameState: DotState = gameDone ? 'done' : status === 'closed' ? 'current' : 'upcoming';

  let statusLine: string;
  if (gameDone) {
    statusLine = "Today's game has started — see you on the field!";
  } else if (status === 'open') {
    statusLine = `Registration closes ${formatDateTime(registrationClosesAt)} (${formatRelative(registrationClosesAt, now)})`;
  } else if (status === 'closed') {
    statusLine =
      now >= cutoffStart
        ? `Game starts ${formatRelative(gameStart, now)} — cancellations now won't trigger an auto-replacement`
        : `Game starts ${formatDateTime(gameStart)} (${formatRelative(gameStart, now)})`;
  } else {
    statusLine = `Registration opens ${formatDateTime(registrationOpensAt)} (${formatRelative(registrationOpensAt, now)})`;
  }

  return (
    <Card className="mt-4">
      <div className="flex items-start">
        <div className="flex flex-col items-center text-center">
          <Dot state={openState} />
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-900">
            <CalendarClock className="h-3.5 w-3.5" /> Registration Opens
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(registrationOpensAt)}</p>
        </div>
        <Line filled={openDone} />
        <div className="flex flex-col items-center text-center">
          <Dot state={closeState} />
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-900">
            <CalendarX2 className="h-3.5 w-3.5" /> Registration Closes
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(registrationClosesAt)}</p>
        </div>
        <Line filled={closeDone} />
        <div className="flex flex-col items-center text-center">
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
