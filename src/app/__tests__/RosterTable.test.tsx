// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RosterTable } from '../admin/page';

const signup = (overrides: Record<string, unknown> = {}) => ({
  signupId: 's1',
  email: 'kevin@dummy.test',
  fullName: 'Kevin Kim',
  memberStatus: 'member' as const,
  invitedByName: '',
  pairId: '',
  status: 'confirmed' as const,
  positions: '',
  paid: false,
  amountPaid: 0,
  attended: false,
  ...overrides,
});

const handlers = {
  busy: false,
  onStatusChange: vi.fn(),
  onPaidChange: vi.fn(),
  onAttendedChange: vi.fn(),
  onRemove: vi.fn(),
};

/** The rendered rows, in order, as their first-cell text. */
function rowLabels() {
  return screen
    .getAllByRole('row')
    .slice(1) // drop the header
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

describe('RosterTable', () => {
  it("shows a re-signup as one person's history, not two people", () => {
    render(
      <RosterTable
        roster={[
          signup({ signupId: 'kevin-old', status: 'cancelled' }),
          signup({ signupId: 'sam', email: 'sam@dummy.test', fullName: 'Sam Lee' }),
          signup({ signupId: 'kevin-new' }),
        ]}
        {...handlers}
      />
    );

    // Kevin's name appears once, with his stale row folded underneath it —
    // rather than twice, scattered, looking like two different Kevins.
    const labels = rowLabels();
    expect(labels[0]).toContain('Kevin Kim');
    expect(labels[1]).toContain('earlier signup');
    expect(labels[1]).not.toContain('Kevin Kim');
    expect(labels[2]).toContain('Sam Lee');
    expect(screen.getAllByText('Kevin Kim')).toHaveLength(1);
  });

  it('still renders every row, since the admin view is the complete picture', () => {
    render(
      <RosterTable
        roster={[signup({ signupId: 'old', status: 'cancelled' }), signup({ signupId: 'new' })]}
        {...handlers}
      />
    );

    // Two rows, so both statuses remain individually editable — and the two
    // controls are distinguishable to a screen reader, not both "Kevin Kim".
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
    expect(screen.getByRole('combobox', { name: 'Status: Kevin Kim' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Status: Kevin Kim (earlier signup)' })
    ).toBeInTheDocument();
  });

  it('shows the email, so two people with the same name are tellable apart', () => {
    render(
      <RosterTable
        roster={[
          signup({ signupId: 'a', email: 'kevin.kim@dummy.test' }),
          signup({ signupId: 'b', email: 'kkim@dummy.test' }),
        ]}
        {...handlers}
      />
    );

    expect(screen.getByText('kevin.kim@dummy.test')).toBeInTheDocument();
    expect(screen.getByText('kkim@dummy.test')).toBeInTheDocument();
  });

  it('flags a person holding two active spots, which is a corrupt roster', () => {
    render(
      <RosterTable
        roster={[signup({ signupId: 'a' }), signup({ signupId: 'b', status: 'waitlisted' })]}
        {...handlers}
      />
    );

    expect(screen.getByText('duplicate')).toBeInTheDocument();
    expect(rowLabels()[1]).toContain('second active signup');
  });

  it('does not flag a cancelled row followed by a new one — that is the normal case', () => {
    render(
      <RosterTable
        roster={[signup({ signupId: 'old', status: 'cancelled' }), signup({ signupId: 'new' })]}
        {...handlers}
      />
    );

    expect(screen.queryByText('duplicate')).not.toBeInTheDocument();
  });

  it('sinks people who cancelled and never came back below the ones playing', () => {
    render(
      <RosterTable
        roster={[
          signup({ signupId: 'gone', email: 'gone@dummy.test', fullName: 'Gone Away', status: 'cancelled' }),
          signup({ signupId: 'playing', email: 'playing@dummy.test', fullName: 'Still Playing' }),
        ]}
        {...handlers}
      />
    );

    const labels = rowLabels();
    expect(labels[0]).toContain('Still Playing');
    expect(labels[1]).toContain('Gone Away');
  });

  it('renders an empty roster without falling over', () => {
    render(<RosterTable roster={[]} {...handlers} />);
    expect(screen.getAllByRole('row')).toHaveLength(1); // header only
  });
});
