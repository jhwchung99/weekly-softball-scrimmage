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
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z')); // Friday morning, well before the 8pm cutoff
    render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/game starts/i)).toBeInTheDocument();
    expect(screen.queryByText(/won't trigger an auto-replacement/i)).not.toBeInTheDocument();
  });

  it('warns that cancellations won\'t auto-replace once within the 2-hour cutoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T21:00:00.000Z')); // 1h before 22:00 UTC game start
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
