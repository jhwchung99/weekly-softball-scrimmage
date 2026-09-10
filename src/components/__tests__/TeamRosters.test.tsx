// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TeamRosters } from '../TeamRosters';
import { GAME_DAY_NOTES } from '../../lib/gameDayNotes';
import type { TeamView, TeamMember } from '../../lib/views';

/**
 * The one rendering of the posted teams, shared by the player homepage and the
 * organizer's dashboard on purpose — so the organizer reviews exactly what
 * everyone else will read. That is precisely what a second copy would break,
 * and it was 20% covered.
 */

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  signupId: 's1',
  fullName: 'Kevin Kim',
  gender: 'Male',
  positions: 'SS',
  pairId: '',
  ...over,
});

const team = (over: Partial<TeamView> = {}): TeamView => ({
  name: 'Team 1',
  members: [],
  deficiency: 0,
  missing: [],
  ...over,
});

describe('TeamRosters', () => {
  it('lists each team with its size', async () => {
    render(
      <TeamRosters
        numFields={1}
        teams={[
          team({ name: 'Team 1', members: [member({ signupId: 'a', fullName: 'Kevin Kim' })] }),
          team({ name: 'Team 2', members: [member({ signupId: 'b', fullName: 'Sarah Lee' })] }),
        ]}
      />
    );

    expect(screen.getByRole('heading', { name: /Team 1 \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('Kevin Kim')).toBeInTheDocument();
    expect(screen.getByText('Sarah Lee')).toBeInTheDocument();
  });

  it('marks a shared spot, so nobody is expected to field two people at once', () => {
    render(<TeamRosters numFields={1} teams={[team({ members: [member({ pairId: 'p1' })] })]} />);

    expect(screen.getByText(/Kevin Kim \(sharing a spot\)/)).toBeInTheDocument();
  });

  it('leaves an unpaired player unmarked', () => {
    // Scoped to the roster entry: the game-day notes below also mention
    // sharing a spot, so an unscoped query matches whatever this renders.
    render(<TeamRosters numFields={1} teams={[team({ members: [member()] })]} />);

    expect(screen.getByText('Kevin Kim').textContent).toBe('Kevin Kim');
  });

  it('says what a short team cannot cover', () => {
    render(<TeamRosters numFields={1} teams={[team({ deficiency: 2, missing: ['Catcher', 'SS'] })]} />);

    expect(screen.getByText('Short 2: no one can cover Catcher, SS')).toBeInTheDocument();
  });

  it('says nothing about a team that can field nine', () => {
    render(<TeamRosters numFields={1} teams={[team({ members: [member()] })]} />);

    expect(screen.queryByText(/^Short /)).not.toBeInTheDocument();
  });

  it('tells an empty team apart from a missing one', () => {
    render(<TeamRosters numFields={1} teams={[team()]} />);

    expect(screen.getByText('No one yet.')).toBeInTheDocument();
  });

  it('points a player at their own team', () => {
    render(
      <TeamRosters
        numFields={1}
        highlightSignupId="mine"
        teams={[
          team({ name: 'Team 1', members: [member({ signupId: 'other', fullName: 'Sarah Lee' })] }),
          team({ name: 'Team 2', members: [member({ signupId: 'mine' })] }),
        ]}
      />
    );

    const marks = screen.getAllByText('your team');
    expect(marks).toHaveLength(1);
    expect(within(marks[0].closest('div')!).getByRole('heading', { name: /Team 2/ })).toBeInTheDocument();
  });

  it('marks nothing when the viewer is not playing', () => {
    render(<TeamRosters numFields={1} teams={[team({ members: [member()] })]} />);

    expect(screen.queryByText('your team')).not.toBeInTheDocument();
  });

  it('counts the fields booked, singular and plural', () => {
    const { unmount } = render(<TeamRosters numFields={1} teams={[]} />);
    expect(screen.getByText('One field booked')).toBeInTheDocument();
    unmount();

    render(<TeamRosters numFields={2} teams={[]} />);
    expect(screen.getByText('2 fields booked')).toBeInTheDocument();
  });

  it('carries the game-day notes, which is where players actually read them', () => {
    render(<TeamRosters numFields={1} teams={[]} />);

    for (const note of GAME_DAY_NOTES) expect(screen.getByText(note)).toBeInTheDocument();
  });
});
