// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeeklyTimeline } from '../WeeklyTimeline';

afterEach(() => {
  vi.useRealTimers();
});

describe('WeeklyTimeline', () => {
  it('renders nothing when the session is cancelled', () => {
    const { container } = render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="cancelled" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the "registration closes" status line while open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T18:00:00.000Z')); // Monday afternoon, before Tuesday midnight close
    render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="open" />);
    expect(screen.getByText(/registration closes tue/i)).toBeInTheDocument();
  });

  it('shows the "game starts" status line once closed, before the cutoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z')); // Friday morning, well before the 1pm ET cutoff
    render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/game starts/i)).toBeInTheDocument();
    expect(screen.queryByText(/won't trigger an auto-replacement/i)).not.toBeInTheDocument();
  });

  it('warns that cancellations won\'t auto-replace once within the 5-hour cutoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T21:00:00.000Z')); // 1h before 22:00 UTC game start, inside the 5h cutoff
    render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/won't trigger an auto-replacement/i)).toBeInTheDocument();
  });

  it('shows a distinct message once the game has already started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T23:00:00.000Z')); // after 22:00 UTC start
    render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/game has started/i)).toBeInTheDocument();
  });

  it('shows the "registration opens" status line before the scheduled Monday open, even if status is already open (created early)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z')); // Friday before the target Friday 2026-07-10's week
    render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="open" />);
    // status is 'open' even though we're before the computed Monday —
    // the status line should reflect the real closing schedule, not
    // pretend registration hasn't opened.
    expect(screen.getByText(/registration closes tue/i)).toBeInTheDocument();
  });
});

/**
 * Regression coverage: 'done' and 'current' used to render the same green, and
 * openDone ignored status === 'open' — so a session opened ahead of its
 * scheduled Monday showed both "Registration Opens" and "Registration Closes"
 * as green at the same time, with two milestones simultaneously current.
 */
describe('WeeklyTimeline milestone states', () => {
  function dotClasses(container: HTMLElement): string[] {
    return [...container.querySelectorAll('div.h-3.w-3')].map((d) => d.className);
  }

  it('marks exactly one milestone as current at a time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z')); // Wednesday, registration open
    const { container } = render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="open" />);

    const current = dotClasses(container).filter((c) => c.includes('amber'));
    expect(current).toHaveLength(1);
  });

  it('treats an early-opened session as having opened, not as pending', () => {
    vi.useFakeTimers();
    // Before the scheduled Monday 9am, but an admin already opened it.
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    const { container } = render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="open" />);

    const [opens, closes, game] = dotClasses(container);
    expect(opens).toContain('green'); // already happened
    expect(closes).toContain('amber'); // the thing we're waiting on
    expect(game).toContain('slate'); // still ahead
  });

  it('treats a not-yet-opened session as pending rather than finished', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z')); // before the week starts
    const { container } = render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="closed" />);

    const [opens, closes] = dotClasses(container);
    expect(opens).toContain('amber'); // next thing to happen
    expect(closes).toContain('slate'); // not 'done' — it never opened
  });

  it('marks both registration milestones done once the window has run its course', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z')); // Thursday, after Tuesday's close
    const { container } = render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="closed" />);

    const [opens, closes, game] = dotClasses(container);
    expect(opens).toContain('green');
    expect(closes).toContain('green');
    expect(game).toContain('amber'); // game day is what's next
  });
});
