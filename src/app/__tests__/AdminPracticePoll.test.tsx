// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PracticePollSection } from '../admin/page';
import type { AdminSessionView, AdminRosterEntry } from '../../lib/views';

/**
 * The organizer's half of the practice poll.
 *
 * The section is deliberately absent on a healthy week: a disabled control
 * that can never be pressed is noise on a card that has just had its clutter
 * cut, so "renders nothing" is a behaviour worth pinning rather than an
 * accident.
 */

const session = (over: Partial<AdminSessionView> = {}): AdminSessionView => ({
  sessionId: '2099-01-02',
  gameDate: '2099-01-02',
  gameTime: '18:00',
  rosterLockAt: '',
  registrationOpensAt: '',
  registrationClosesAt: '',
  capacity: 20,
  numFields: 1,
  status: 'open',
  pricePerSpot: 10,
  locationArea: 'Mississauga',
  locationName: '',
  locationUrl: '',
  teamsStatus: '',
  format: 'game',
  practicePollStatus: '',
  practicePollClosesAt: '',
  cost: 0,
  remindersSentAt: '',
  practicePollThreshold: 0,
  ...over,
});

let n = 0;
const entry = (over: Partial<AdminRosterEntry> = {}): AdminRosterEntry => ({
  signupId: `s${(n += 1)}`,
  email: `p${n}@dummy.test`,
  fullName: `Player ${n}`,
  memberStatus: 'member',
  invitedByName: '',
  pairId: '',
  status: 'confirmed',
  positions: '',
  paid: false,
  amountPaid: 0,
  attended: false,
  practicePollAnswer: '',
  ...over,
});

const roster = (count: number, over: Partial<AdminRosterEntry> = {}) =>
  Array.from({ length: count }, () => entry(over));

const props = {
  thresholdInput: '',
  setThresholdInput: vi.fn(),
  closesAt: '',
  setClosesAt: vi.fn(),
  notify: true,
  setNotify: vi.fn(),
  busy: false,
  onSetPoll: vi.fn(),
  onSetFormat: vi.fn(),
  onSaveThreshold: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe('PracticePollSection', () => {
  it('renders nothing on a healthy week with no poll', () => {
    const { container } = render(
      <PracticePollSection {...props} session={session()} roster={roster(16)} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers the poll once the week is light', () => {
    render(<PracticePollSection {...props} session={session()} roster={roster(15)} />);

    expect(screen.getByRole('button', { name: /Open practice poll/i })).toBeEnabled();
  });

  it('counts spots rather than heads, so a shared spot does not hide a light week', () => {
    // Fifteen spots where two are shared is seventeen people and still not a
    // game. Counting heads would put this at 17 and withhold the poll.
    const shared = [...roster(13), entry({ pairId: 'p1' }), entry({ pairId: 'p1' }), entry({ pairId: 'p2' }), entry({ pairId: 'p2' })];

    render(<PracticePollSection {...props} session={session()} roster={shared} />);

    expect(screen.getByRole('button', { name: /Open practice poll/i })).toBeEnabled();
    expect(screen.getByText(/15 confirmed spots now/i)).toBeInTheDocument();
  });

  it('uses the session’s own threshold', () => {
    render(<PracticePollSection {...props} session={session({ practicePollThreshold: 20 })} roster={roster(18)} />);

    expect(screen.getByRole('button', { name: /Open practice poll/i })).toBeEnabled();
    expect(screen.getByText(/usual 20/i)).toBeInTheDocument();
  });

  it('shows the tally and a close button while the poll is open', () => {
    render(
      <PracticePollSection
        {...props}
        session={session({ practicePollStatus: 'open' })}
        roster={[
          entry({ practicePollAnswer: 'yes', fullName: 'Yes One' }),
          entry({ practicePollAnswer: 'no', fullName: 'No One' }),
          entry({ fullName: 'Quiet One' }),
        ]}
      />
    );

    expect(screen.getByText(/Yes 1, no 1, no answer 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Yes One/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close poll/i })).toBeEnabled();
  });

  it('says closing emails nobody', () => {
    render(<PracticePollSection {...props} session={session({ practicePollStatus: 'open' })} roster={roster(8)} />);

    expect(screen.getByText(/Closing emails nobody/i)).toBeInTheDocument();
  });

  it('flags a week whose turnout recovered, without closing anything', () => {
    render(<PracticePollSection {...props} session={session({ practicePollStatus: 'open' })} roster={roster(16)} />);

    expect(screen.getByText(/at or above the 16 you set/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close poll/i })).toBeInTheDocument();
  });

  it('lets a closed poll be reopened while the week is still light', () => {
    render(<PracticePollSection {...props} session={session({ practicePollStatus: 'closed' })} roster={roster(9)} />);

    expect(screen.getByRole('button', { name: /Reopen poll/i })).toBeEnabled();
  });

  it('marks the week, and says that marking it tells nobody', async () => {
    render(<PracticePollSection {...props} session={session({ practicePollStatus: 'closed' })} roster={roster(9)} />);

    expect(screen.getByText(/Emails nobody/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mark as BP\/Practice/i }));

    expect(props.onSetFormat).toHaveBeenCalledWith('practice');
  });

  it('offers the way back on a week already marked as practice', async () => {
    render(<PracticePollSection {...props} session={session({ format: 'practice' })} roster={roster(9)} />);

    await userEvent.click(screen.getByRole('button', { name: /Mark as a game/i }));
    expect(props.onSetFormat).toHaveBeenCalledWith('game');
  });

  it('stays on screen for a practice week even when turnout is fine', () => {
    // The format is the thing being shown now, not the poll. Hiding the
    // section would leave no way back to a game.
    render(<PracticePollSection {...props} session={session({ format: 'practice' })} roster={roster(20)} />);

    expect(screen.getByRole('button', { name: /Mark as a game/i })).toBeInTheDocument();
  });
});
