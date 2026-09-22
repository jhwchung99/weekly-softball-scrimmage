// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerArea } from '../page';
import type { SignupInfo, SessionInfo } from '../page';

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
  numFields: 1,
  rosterLockAt: '',
  teamsStatus: '' as const,
  format: 'game' as const,
  practicePollStatus: '' as const,
  practicePollClosesAt: '',
};

const baseProps = {
  scrimmage,
  // The server's answer now, so these tests state the phase outright instead
  // of moving the system clock to trick a browser-side derivation.
  phase: 'open' as const,
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
  onPollAnswered: vi.fn(),
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
        mySignup={{ signupId: 's1', status: 'confirmed', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '', practicePollAnswer: '' }}
      />
    );
    expect(screen.getByText(/confirmed to play/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel my spot/i })).toBeInTheDocument();
  });

  it('shows the sub-request panel only when waitlisted, not when confirmed', () => {
    const { rerender } = render(
      <PlayerArea
        {...baseProps}
        mySignup={{ signupId: 's1', status: 'confirmed', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '', practicePollAnswer: '' }}
      />
    );
    expect(screen.queryByRole('button', { name: /ask to share/i })).not.toBeInTheDocument();

    rerender(
      <PlayerArea
        {...baseProps}
        mySignup={{ signupId: 's1', status: 'waitlisted', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '', practicePollAnswer: '' }}
      />
    );
    expect(screen.getByRole('button', { name: /ask to share/i })).toBeInTheDocument();
  });

  it('shows the cost share only when confirmed and a share is known', () => {
    render(
      <PlayerArea
        {...baseProps}
        costOwed={7.5}
        mySignup={{ signupId: 's1', status: 'confirmed', memberStatus: 'member', paid: false, subRequestTargetEmail: '', subRequestStatus: '', practicePollAnswer: '' }}
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

  const confirmed: SignupInfo = {
    signupId: 's1',
    status: 'confirmed' as const,
    memberStatus: 'member' as const,
    paid: false,
    subRequestTargetEmail: '',
    subRequestStatus: '' as const,
    practicePollAnswer: '' as const,
  };

  it('does not ask for payment while the lineup can still change', () => {
    render(<PlayerArea {...baseProps} phase="closed" mySignup={confirmed} costOwed={10} />);

    expect(screen.getByText(/nothing to pay yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/you owe/i)).not.toBeInTheDocument();
  });

  it('asks for payment once the roster is locked', () => {
    render(<PlayerArea {...baseProps} phase="locked" mySignup={confirmed} costOwed={10} />);

    expect(screen.getByText(/please send it before the game starts/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing to pay yet/i)).not.toBeInTheDocument();
  });

  it('shows the payment instructions only once payment is open', () => {
    render(<PlayerArea {...baseProps} phase="locked" mySignup={confirmed} costOwed={10} paymentInstructions="e-Transfer to x@y.test" />);

    expect(screen.getByText(/e-Transfer to x@y.test/)).toBeInTheDocument();
  });
});

/**
 * After the lock nobody is auto-promoted, so a spot only gets filled if the
 * organizer texts someone — and the default assumption would be that the
 * organizer then sorts out the money. The notice exists to say otherwise. It's
 * informational: it never blocks the cancellation.
 */
describe('PlayerArea locked-cancellation notice', () => {
  afterEach(() => vi.useRealTimers());

  const confirmed = {
    signupId: 's1',
    status: 'confirmed' as const,
    memberStatus: 'member' as const,
    paid: false,
    subRequestTargetEmail: '',
    subRequestStatus: '' as const,
    practicePollAnswer: '' as const,
  };

  it('is not shown while cancelling is still free', () => {
    render(<PlayerArea {...baseProps} phase="closed" mySignup={confirmed} costOwed={10} />);

    // "roster is locked" also appears in the pre-lock payment copy, so match
    // on wording unique to the notice.
    expect(screen.queryByText(/between the two of you/i)).not.toBeInTheDocument();
  });

  it('covers both the unpaid and already-paid cases, and who collects from a sub', () => {
    render(<PlayerArea {...baseProps} phase="locked" mySignup={confirmed} costOwed={10} />);

    expect(screen.getByText(/if you have not sent payment, please still send your \$10\.00/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody is added in your place automatically this late/i)).toBeInTheDocument();
    expect(screen.getByText(/between the two of you/i)).toBeInTheDocument();
  });

  it('reads the same whether or not the payment is already recorded', () => {
    render(<PlayerArea {...baseProps} phase="locked" mySignup={{ ...confirmed, paid: true }} costOwed={10} />);

    // One block covering both cases, so there's only ever one message to keep
    // accurate rather than two that can drift apart.
    expect(screen.getByText(/if you have not sent payment/i)).toBeInTheDocument();
    expect(screen.getByText(/if you have sent the payment/i)).toBeInTheDocument();
  });

  it('is omitted when the week has no price set — every sentence is about payment', () => {
    render(<PlayerArea {...baseProps} phase="locked" mySignup={confirmed} costOwed={null} />);

    expect(screen.queryByText(/between the two of you/i)).not.toBeInTheDocument();
  });

  it('still lets them cancel — the notice never blocks it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T19:00:00.000Z'));
    const onCancel = vi.fn();
    render(<PlayerArea {...baseProps} mySignup={confirmed} costOwed={10} onCancel={onCancel} />);

    screen.getByRole('button', { name: /cancel my spot/i }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

/**
 * The practice poll as a player meets it. The property worth guarding hardest
 * is what is absent: no counts, no other people's answers.
 */
describe('the practice poll panel', () => {
  const confirmed = {
    signupId: 's1',
    status: 'confirmed' as const,
    memberStatus: 'member' as const,
    paid: false,
    subRequestTargetEmail: '',
    subRequestStatus: '' as const,
    practicePollAnswer: '' as const,
  };

  const withPoll = (pollOver: Partial<SessionInfo>, signupOver: Partial<SignupInfo> = {}) => ({
    ...baseProps,
    scrimmage: { ...scrimmage, ...pollOver },
    mySignup: { ...confirmed, ...signupOver },
  });

  it('asks a confirmed player while the poll is open', () => {
    render(<PlayerArea {...withPoll({ practicePollStatus: 'open' })} />);

    expect(screen.getByText(/come out for BP\/Practice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No' })).toBeEnabled();
  });

  it('never shows a player the tally', () => {
    // The privacy property this feature turns on. An open poll reading
    // "9 yes, 2 no" makes an honest answer into a vote on a decision that
    // looks already settled.
    render(<PlayerArea {...withPoll({ practicePollStatus: 'open' })} />);

    expect(screen.queryByText(/\d+ yes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no answer/i)).not.toBeInTheDocument();
  });

  it('carries the recruit line and says nothing about cost', () => {
    render(<PlayerArea {...withPoll({ practicePollStatus: 'open' })} />);

    expect(screen.getByText(/message the organizer and they can manually add them/i)).toBeInTheDocument();
    expect(screen.getByText(/the field will be booked/i)).toBeInTheDocument();
    expect(screen.queryByText(/cheaper|lower cost|cost down/i)).not.toBeInTheDocument();
  });

  it('shows the deadline only when one was set', () => {
    const { unmount } = render(<PlayerArea {...withPoll({ practicePollStatus: 'open' })} />);
    expect(screen.queryByText(/Answer by/i)).not.toBeInTheDocument();
    unmount();

    render(
      <PlayerArea {...withPoll({ practicePollStatus: 'open', practicePollClosesAt: '2099-01-01T22:00:00.000Z' })} />
    );
    expect(screen.getByText(/Answer by/i)).toBeInTheDocument();
  });

  it('stays visible and read-only once the poll closes', () => {
    // For the player added by hand on Thursday, who would otherwise see no
    // sign the week was ever in question.
    render(<PlayerArea {...withPoll({ practicePollStatus: 'closed' }, { practicePollAnswer: 'yes' })} />);

    expect(screen.getByText(/BP\/Practice was being decided/i)).toBeInTheDocument();
    expect(screen.getByText(/You said yes/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No' })).not.toBeInTheDocument();
  });

  it('tells someone who never answered that the organizer will say', () => {
    render(<PlayerArea {...withPoll({ practicePollStatus: 'closed' })} />);

    expect(screen.getByText(/You did not answer/i)).toBeInTheDocument();
  });

  it('shows nothing at all when no poll was ever opened', () => {
    render(<PlayerArea {...withPoll({})} />);

    expect(screen.queryByText(/BP\/Practice/i)).not.toBeInTheDocument();
  });

  it('shows nothing to a waitlisted player, who cannot answer', () => {
    render(<PlayerArea {...withPoll({ practicePollStatus: 'open' }, { status: 'waitlisted' })} />);

    expect(screen.queryByText(/come out for BP\/Practice/i)).not.toBeInTheDocument();
  });

  it('says confirmed for BP/Practice once the week is marked', () => {
    render(
      <PlayerArea
        {...baseProps}
        scrimmage={{ ...scrimmage, format: 'practice' }}
        mySignup={confirmed}
      />
    );

    expect(screen.getByText(/confirmed for BP\/Practice/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirmed to play/i)).not.toBeInTheDocument();
  });
});
