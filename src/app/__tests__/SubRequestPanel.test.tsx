// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubRequestPanel } from '../page';

describe('SubRequestPanel', () => {
  it('shows the request form (with the courtesy note) when there is no active request', () => {
    render(
      <SubRequestPanel
        subRequestTargetEmail=""
        subRequestStatus=""
        busy={false}
        setBusy={vi.fn()}
        setError={vi.fn()}
        onRequestSub={vi.fn()}
        onCancelSubRequest={vi.fn()}
      />
    );
    expect(screen.getByText(/reaching out to them outside the app first/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request to sub/i })).toBeInTheDocument();
  });

  it('shows the waiting state and a Cancel request button when pending, hiding the form', () => {
    render(
      <SubRequestPanel
        subRequestTargetEmail="target@dummy.test"
        subRequestStatus="pending"
        busy={false}
        setBusy={vi.fn()}
        setError={vi.fn()}
        onRequestSub={vi.fn()}
        onCancelSubRequest={vi.fn()}
      />
    );
    expect(screen.getByText(/waiting on target@dummy.test/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request to sub/i })).not.toBeInTheDocument();
  });

  it('shows the declined message and re-shows the form when declined', () => {
    render(
      <SubRequestPanel
        subRequestTargetEmail="target@dummy.test"
        subRequestStatus="declined"
        busy={false}
        setBusy={vi.fn()}
        setError={vi.fn()}
        onRequestSub={vi.fn()}
        onCancelSubRequest={vi.fn()}
      />
    );
    expect(screen.getByText(/target@dummy.test declined/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request to sub/i })).toBeInTheDocument();
  });

  it('calls onRequestSub with the trimmed email on submit', async () => {
    const onRequestSub = vi.fn();
    render(
      <SubRequestPanel
        subRequestTargetEmail=""
        subRequestStatus=""
        busy={false}
        setBusy={vi.fn()}
        setError={vi.fn()}
        onRequestSub={onRequestSub}
        onCancelSubRequest={vi.fn()}
      />
    );
    await userEvent.type(screen.getByLabelText(/their email/i), '  target@dummy.test  ');
    await userEvent.click(screen.getByRole('button', { name: /request to sub/i }));
    expect(onRequestSub).toHaveBeenCalledWith('target@dummy.test');
  });

  it('calls onCancelSubRequest when Cancel request is clicked', async () => {
    const onCancelSubRequest = vi.fn();
    render(
      <SubRequestPanel
        subRequestTargetEmail="target@dummy.test"
        subRequestStatus="pending"
        busy={false}
        setBusy={vi.fn()}
        setError={vi.fn()}
        onRequestSub={vi.fn()}
        onCancelSubRequest={onCancelSubRequest}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel request/i }));
    expect(onCancelSubRequest).toHaveBeenCalledTimes(1);
  });
});
