import { Users } from 'lucide-react';
import { Card } from './Card';
import { GAME_DAY_NOTES } from '../lib/gameDayNotes';

export interface TeamView {
  name: string;
  members: { signupId: string; fullName: string; positions: string; pairId: string }[];
  deficiency: number;
  missing: string[];
}

/** "Short 1: no one can cover Catcher", or nothing when the team is fine. */
export function teamNoteText(team: Pick<TeamView, 'deficiency' | 'missing'>): string {
  if (team.deficiency === 0) return '';
  return `Short ${team.deficiency}: no one can cover ${team.missing.join(', ')}`;
}

/**
 * The posted teams, plus the notes that go with them.
 *
 * Shared by the player homepage and the admin dashboard so the organizer
 * reviews exactly what everyone else will read, rather than a second rendering
 * of the same data that can drift.
 */
export function TeamRosters({
  teams,
  numFields,
  highlightSignupId,
}: {
  teams: TeamView[];
  numFields: number;
  highlightSignupId?: string;
}) {
  return (
    <Card className="mt-4">
      <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
        <Users className="h-4 w-4" /> Teams
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {numFields > 1 ? `${numFields} fields booked` : 'One field booked'}
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {teams.map((team) => {
          const note = teamNoteText(team);
          const mine = highlightSignupId && team.members.some((m) => m.signupId === highlightSignupId);
          return (
            <div
              key={team.name}
              className={`rounded border p-3 ${mine ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}
            >
              <h3 className="text-sm font-medium text-slate-900">
                {team.name} ({team.members.length})
                {mine ? <span className="ml-1 text-xs font-normal text-blue-700">your team</span> : null}
              </h3>
              <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                {team.members.map((m) => (
                  <li key={m.signupId}>
                    {m.fullName}
                    {m.pairId ? ' (sharing a spot)' : ''}
                  </li>
                ))}
                {team.members.length === 0 && <li className="text-slate-400">No one yet.</li>}
              </ul>
              {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-medium text-slate-700">Notes</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {GAME_DAY_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
