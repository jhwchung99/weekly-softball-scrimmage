// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamEditor } from '../TeamEditor';

/**
 * The coverage note is the only signal this screen gives about whether a move
 * made a team unplayable, so it has to be true at the moment it is shown —
 * especially right after a move, which is when the organizer is most likely to
 * have just created the gap.
 */

const member = (over: Record<string, unknown> = {}) => ({
  signupId: 's1',
  fullName: 'Someone',
  gender: 'Other',
  positions: 'Outfield',
  pairId: '',
  ...over,
});

/** Two teams. Only Cathy can catch — the others are outfielders, not
 * wildcards, so "nobody can cover Catcher" is a real statement about them. */
const TEAMS_RESPONSE = {
  teamsStatus: 'draft',
  numFields: 1,
  teams: [
    {
      name: 'Team 1',
      members: [
        member({ signupId: 'cathy', fullName: 'Cathy Catcher', positions: 'Catcher' }),
        member({ signupId: 'andy', fullName: 'Andy Outfield' }),
      ],
      deficiency: 7,
      missing: ['1B', '2B', '3B', 'SS', 'Outfield', 'Rover'],
    },
    {
      name: 'Team 2',
      members: [member({ signupId: 'bob', fullName: 'Bob Outfield' })],
      deficiency: 8,
      missing: ['Catcher', '1B', '2B', '3B', 'SS', 'Outfield', 'Rover'],
    },
  ],
};

/** The team's own panel, so notes can be read one team at a time. */
function panel(name: string) {
  return screen.getByRole('heading', { name: new RegExp(`^${name} \\(`) }).closest('div')!;
}

function noteFor(name: string): string {
  return within(panel(name)).queryByText(/^Short \d/)?.textContent ?? '';
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(TEAMS_RESPONSE) }))
  );
});

describe('TeamEditor coverage notes', () => {
  it('warns that a team can no longer cover Catcher once its only catcher is moved away', async () => {
    render(<TeamEditor sessionId="2099-01-01" />);
    await screen.findByText('Cathy Catcher');

    // Team 1 has a catcher to begin with, so its note says nothing about one.
    expect(noteFor('Team 1')).not.toMatch(/Catcher/);

    await userEvent.selectOptions(screen.getByLabelText('Team for Cathy Catcher'), 'Team 2');

    await waitFor(() => expect(noteFor('Team 1')).toMatch(/Catcher/));
  });

  it('recomputes the gaining team too, rather than blanking its note', async () => {
    render(<TeamEditor sessionId="2099-01-01" />);
    await screen.findByText('Cathy Catcher');

    expect(noteFor('Team 2')).toMatch(/Catcher/);

    await userEvent.selectOptions(screen.getByLabelText('Team for Cathy Catcher'), 'Team 2');

    // Still short — two players cannot field nine — but no longer short a catcher.
    await waitFor(() => expect(noteFor('Team 2')).toMatch(/^Short \d/));
    expect(noteFor('Team 2')).not.toMatch(/Catcher/);
  });

  it('still reports the deficiency of a team the organizer has not touched', async () => {
    render(<TeamEditor sessionId="2099-01-01" />);
    await screen.findByText('Cathy Catcher');

    // Bob covers one slot of nine on his own, and cannot catch.
    expect(noteFor('Team 2')).toMatch(/^Short 8: no one can cover .*Catcher/);
  });
});
