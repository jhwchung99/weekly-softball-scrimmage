'use client';

import { useEffect, useState } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { GAME_DAY_NOTES } from '../lib/gameDayNotes';
import { teamNoteText, TeamView } from './TeamRosters';
import type { TeamsStatus } from '../sheets/schema';
import { isPaired, spotKey, SHARING_A_SPOT } from '../lib/pair';
// The same coverage analysis the generator runs. Calling it rather than
// approximating it is the point: the note under an edited team has to be true
// while the organizer is still moving people, which is when a gap gets made.
import { analyzeTeam } from '../lib/teams';

interface TeamsResponse {
  teamsStatus: TeamsStatus;
  numFields: number;
  teams: TeamView[];
}

type Member = TeamView['members'][number];

/**
 * The organizer's team editor.
 *
 * Moves are held in React state and nothing reaches the sheet until Save, so
 * shuffling a roster costs no Sheets writes. Post is separate from Save
 * because a draft is the organizer's to work on: players see nothing until
 * they publish. Both halves of a shared spot move together, matching the
 * generator, since they are one roster spot.
 */
export function TeamEditor({ sessionId, onChanged }: { sessionId: string; onChanged?: () => void }) {
  const [state, setState] = useState<TeamsResponse | null>(null);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Nothing sets state before the first await, so mounting this doesn't
  // trigger a synchronous cascade of renders from inside the effect.
  async function load() {
    try {
      const res = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/teams`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not load teams.');
      const data: TeamsResponse = await res.json();
      setState(data);
      setMembers(Object.fromEntries(data.teams.map((t) => [t.name, t.members])));
      setDirty(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shared with the reload after every action; setState only runs after an await
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'That did not work.');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function move(member: Member, to: string) {
    setMembers((prev) => {
      const next: Record<string, Member[]> = {};
      // A shared spot is one roster spot, so its two occupants move as one.
      // A shared spot is one roster spot, so its occupants move as one.
      const moving = (m: Member) => spotKey(m) === spotKey(member);
      for (const [team, list] of Object.entries(prev)) next[team] = list.filter((m) => !moving(m));
      const taken = Object.values(prev).flat().filter(moving);
      next[to] = [...(next[to] ?? []), ...taken];
      return next;
    });
    setDirty(true);
  }

  if (!state) {
    return (
      <Card className="mt-4">
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading teams...
        </p>
      </Card>
    );
  }

  const names = Object.keys(members);
  const assignments = names.flatMap((name) => members[name].map((m) => ({ signupId: m.signupId, teamName: name })));
  const anyPlayers = assignments.length > 0;

  return (
    <Card className="mt-4">
      <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
        <Users className="h-4 w-4" /> Teams
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {state.teamsStatus === 'posted' ? 'Posted. Players can see these.' : null}
        {state.teamsStatus === 'draft' ? 'Draft. Players cannot see these yet.' : null}
        {state.teamsStatus === '' ? 'Not generated yet.' : null}
        {dirty ? ' Unsaved changes.' : null}
      </p>

      {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {anyPlayers && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {names.map((name) => {
            const note = teamNoteText(analyzeTeam(members[name]));
            return (
              <div key={name} className="rounded border border-slate-200 p-3">
                <h3 className="text-sm font-medium text-slate-900">
                  {name} ({members[name].length})
                </h3>
                <ul className="mt-1 space-y-1 text-sm text-slate-600">
                  {members[name].map((m) => (
                    <li key={m.signupId} className="flex items-center justify-between gap-2">
                      <span>
                        {m.fullName}
                        {isPaired(m) ? ` (${SHARING_A_SPOT})` : ''}
                      </span>
                      <select
                        aria-label={`Team for ${m.fullName}`}
                        value={name}
                        disabled={busy}
                        onChange={(e) => move(m, e.target.value)}
                        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                      >
                        {names.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                  {members[name].length === 0 && <li className="text-slate-400">No one yet.</li>}
                </ul>
                {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !dirty} onClick={() => act({ assignments })}>
          Save rosters
        </Button>
        <Button
          size="sm"
          variant="success"
          disabled={busy || dirty || !anyPlayers || state.teamsStatus === 'posted'}
          onClick={() => act({ action: 'post' })}
        >
          Post to players
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (state.teamsStatus === '' || window.confirm('Regenerate teams? Any manual changes will be lost.')) {
              act({ action: 'generate' });
            }
          }}
        >
          {state.teamsStatus === '' ? 'Generate teams' : 'Regenerate'}
        </Button>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-medium text-slate-700">Notes shown to players</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {GAME_DAY_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
