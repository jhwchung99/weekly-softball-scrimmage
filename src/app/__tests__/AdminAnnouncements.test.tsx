// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyPlayersPanel, RemindUnpaidButton } from '../admin/page';

const signup = (overrides: Record<string, unknown> = {}) => ({
  signupId: 's1',
  email: 'a@dummy.test',
  fullName: 'A',
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotifyPlayersPanel', () => {
  const open = { status: 'open' as const };
  const cancelled = { status: 'cancelled' as const };

  it('counts confirmed players only while the session is on', () => {
    render(
      <NotifyPlayersPanel
        session={open}
        roster={[
          signup({ signupId: 'a', status: 'confirmed' }),
          signup({ signupId: 'b', status: 'waitlisted' }),
          signup({ signupId: 'c', status: 'cancelled' }),
        ]}
        note=""
        setNote={vi.fn()}
        busy={false}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Notify 1 player' })).toBeInTheDocument();
    expect(screen.getByText(/confirmed only/)).toBeInTheDocument();
  });

  it('counts the waitlist too once the session is cancelled', () => {
    render(
      <NotifyPlayersPanel
        session={cancelled}
        roster={[
          signup({ signupId: 'a', status: 'confirmed' }),
          signup({ signupId: 'b', status: 'waitlisted' }),
          signup({ signupId: 'c', status: 'cancelled' }),
        ]}
        note=""
        setNote={vi.fn()}
        busy={false}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Notify 2 players' })).toBeInTheDocument();
    expect(screen.getByText(/confirmed and waitlisted/)).toBeInTheDocument();
  });

  it('passes the note along and names the cancellation in the confirmation prompt', async () => {
    const onSend = vi.fn();
    render(
      <NotifyPlayersPanel
        session={cancelled}
        roster={[signup()]}
        note="Rained out."
        setNote={vi.fn()}
        busy={false}
        onSend={onSend}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Notify 1 player' }));

    expect(onSend).toHaveBeenCalledWith('Email 1 player about the cancellation?', { note: 'Rained out.' });
  });

  it('cannot be pressed when there is nobody to email', () => {
    render(
      <NotifyPlayersPanel
        session={open}
        roster={[signup({ status: 'waitlisted' })]}
        note=""
        setNote={vi.fn()}
        busy={false}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Notify 0 players' })).toBeDisabled();
  });
});

describe('RemindUnpaidButton', () => {
  const priced = { pricePerSpot: 10 };

  it('offers to email only the confirmed players who still owe', () => {
    render(
      <RemindUnpaidButton
        session={priced}
        roster={[
          signup({ signupId: 'a', status: 'confirmed', paid: false }),
          signup({ signupId: 'b', status: 'confirmed', paid: true, amountPaid: 10 }),
          signup({ signupId: 'c', status: 'waitlisted', paid: false }),
        ]}
        busy={false}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Remind 1 unpaid' })).toBeInTheDocument();
  });

  it('renders nothing when everyone has paid, rather than a button that can only do nothing', () => {
    const { container } = render(
      <RemindUnpaidButton
        session={priced}
        roster={[signup({ status: 'confirmed', paid: true, amountPaid: 10 })]}
        busy={false}
        onSend={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the session has no price, since nobody can owe anything', () => {
    const { container } = render(
      <RemindUnpaidButton
        session={{ pricePerSpot: 0 }}
        roster={[signup({ status: 'confirmed', paid: false })]}
        busy={false}
        onSend={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('counts a shared spot as two people to chase, since each owes their half', async () => {
    const onSend = vi.fn();
    render(
      <RemindUnpaidButton
        session={priced}
        roster={[
          signup({ signupId: 'a', status: 'confirmed', pairId: 'p1' }),
          signup({ signupId: 'b', status: 'confirmed', pairId: 'p1' }),
        ]}
        busy={false}
        onSend={onSend}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remind 2 unpaid' }));

    expect(onSend).toHaveBeenCalledWith('Email 2 unpaid players about what they owe?');
  });
});
