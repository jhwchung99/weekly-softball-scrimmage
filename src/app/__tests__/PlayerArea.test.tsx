// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerArea } from '../page';

const scrimmage = {
  sessionId: '2099-01-01',
  gameDate: '2099-01-01',
  gameTime: '18:00',
  capacity: 10,
  status: 'open' as const,
  pricePerSpot: 0,
  locationArea: '',
  locationName: '',
  locationUrl: '',
};

const baseProps = {
  scrimmage,
  registrationClosed: false,
  mySignup: null,
  myPlayer: null,
  waiverText: 'Waiver text',
  costOwed: null,
  waitlistPosition: null,
  paymentInstructions: '',
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
    render(<PlayerArea {...baseProps} myPlayer={{ fullName: 'A', gender: 'M', savedPositions: '' }} />);
    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
  });

  it('shows a "registration closed" message instead of a signup form once closed, for a visitor with no signup', () => {
    render(<PlayerArea {...baseProps} myPlayer={{ fullName: 'A', gender: 'M', savedPositions: '' }} registrationClosed={true} />);
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

/**
 * Payment deliberately doesn't open until the roster locks (5 hours before
 * game time, the same moment auto-promotion stops). Before that the lineup can
 * still change, so charging early would create paid-then-replaced cases the
 * organizer would have to reconcile by hand.
 *
 * The fixture game is 2099-01-01 at 18:00 ET (EST, so 23:00 UTC), which puts
 * the lock at 18:00 UTC.
 */
describe('PlayerArea payment timing', () => {
  afterEach(() => vi.useRealTimers());

  const confirmed = {
    signupId: 's1',
    status: 'confirmed' as const,
    memberStatus: 'member' as const,
    subRequestTargetEmail: '',
    subRequestStatus: '' as const,
  };

  it('does not ask for payment while the lineup can still change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T12:00:00.000Z')); // 6 hours before the lock
    render(<PlayerArea {...baseProps} mySignup={confirmed} costOwed={10} />);

    expect(screen.getByText(/nothing to pay yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/you owe/i)).not.toBeInTheDocument();
  });

  it('asks for payment once the roster is locked', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T19:00:00.000Z')); // an hour after the lock
    render(<PlayerArea {...baseProps} mySignup={confirmed} costOwed={10} />);

    expect(screen.getByText(/you owe/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing to pay yet/i)).not.toBeInTheDocument();
  });

  it('shows the payment instructions only once payment is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T19:00:00.000Z'));
    render(<PlayerArea {...baseProps} mySignup={confirmed} costOwed={10} paymentInstructions="e-Transfer to x@y.test" />);

    expect(screen.getByText(/e-Transfer to x@y.test/)).toBeInTheDocument();
  });
});
