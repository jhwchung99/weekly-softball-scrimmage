// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerArea } from '../page';

const scrimmage = { sessionId: '2099-01-01', gameDate: '2099-01-01', gameTime: '18:00', capacity: 10, status: 'open' as const };

const baseProps = {
  scrimmage,
  registrationClosed: false,
  mySignup: null,
  myPlayer: null,
  waiverText: 'Waiver text',
  costOwed: null,
  loaded: true,
  busy: false,
  setBusy: vi.fn(),
  setError: vi.fn(),
  onCancel: vi.fn(),
  onRefresh: vi.fn(),
  onRequestSub: vi.fn(),
  onCancelSubRequest: vi.fn(),
};

describe('PlayerArea', () => {
  it('shows a loading message while player data has not loaded yet', () => {
    render(<PlayerArea {...baseProps} loaded={false} />);
    expect(screen.getByText(/loading your status/i)).toBeInTheDocument();
  });

  it('shows the profile form when there is no saved profile yet and registration is open', () => {
    render(<PlayerArea {...baseProps} myPlayer={null} registrationClosed={false} />);
    expect(screen.getByText(/first time here/i)).toBeInTheDocument();
  });

  it('shows the signup form once a profile exists and registration is open', () => {
    render(<PlayerArea {...baseProps} myPlayer={{ fullName: 'A', gender: 'M', age: 30, savedPositions: '' }} />);
    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
  });

  it('shows a "registration closed" message instead of a signup form once closed, for a visitor with no signup', () => {
    render(<PlayerArea {...baseProps} myPlayer={{ fullName: 'A', gender: 'M', age: 30, savedPositions: '' }} registrationClosed={true} />);
    expect(screen.getByText(/registration is currently closed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^sign up$/i })).not.toBeInTheDocument();
  });

  it('still shows an existing signup\'s status and Cancel button even when registration is closed (the fixed bug)', () => {
    render(
      <PlayerArea
        {...baseProps}
        registrationClosed={true}
        mySignup={{ signupId: 's1', status: 'confirmed', memberStatus: 'member', subRequestTargetEmail: '', subRequestStatus: '' }}
      />
    );
    expect(screen.getByText(/confirmed to play/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel my spot/i })).toBeInTheDocument();
  });

  it('shows the sub-request panel only when waitlisted, not when confirmed', () => {
    const { rerender } = render(
      <PlayerArea
        {...baseProps}
        mySignup={{ signupId: 's1', status: 'confirmed', memberStatus: 'member', subRequestTargetEmail: '', subRequestStatus: '' }}
      />
    );
    expect(screen.queryByRole('button', { name: /request to sub/i })).not.toBeInTheDocument();

    rerender(
      <PlayerArea
        {...baseProps}
        mySignup={{ signupId: 's1', status: 'waitlisted', memberStatus: 'member', subRequestTargetEmail: '', subRequestStatus: '' }}
      />
    );
    expect(screen.getByRole('button', { name: /request to sub/i })).toBeInTheDocument();
  });

  it('shows the cost share only when confirmed and a share is known', () => {
    render(
      <PlayerArea
        {...baseProps}
        costOwed={7.5}
        mySignup={{ signupId: 's1', status: 'confirmed', memberStatus: 'member', subRequestTargetEmail: '', subRequestStatus: '' }}
      />
    );
    expect(screen.getByText(/\$7\.50/)).toBeInTheDocument();
  });
});
