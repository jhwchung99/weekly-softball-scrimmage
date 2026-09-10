// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeeklyTimeline } from '../WeeklyTimeline';

afterEach(() => {
  vi.useRealTimers();
});

describe('WeeklyTimeline', () => {
  it('renders nothing when the session is cancelled', () => {
    const { container } = render(<WeeklyTimeline gameDate="2026-07-10" gameTime="18:00" status="cancelled" phase="open" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the "registration closes" status line while open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T18:00:00.000Z')); // Monday afternoon, before Tuesday midnight close
    render(<WeeklyTimeline phase="open" gameDate="2026-07-10" gameTime="18:00" status="open" />);
    expect(screen.getByText(/registration closes tue/i)).toBeInTheDocument();
  });

  it('shows the "game starts" status line once closed, before the cutoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z')); // Friday morning, well before the 1pm ET cutoff
    render(<WeeklyTimeline phase="closed" gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/game starts/i)).toBeInTheDocument();
    expect(screen.queryByText(/won't trigger an auto-replacement/i)).not.toBeInTheDocument();
  });

  it('warns that cancellations won\'t auto-replace once within the 5-hour cutoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T21:00:00.000Z')); // 1h before 22:00 UTC game start, inside the 5h cutoff
    render(<WeeklyTimeline phase="locked" gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/won't trigger an auto-replacement/i)).toBeInTheDocument();
  });

  it('shows a distinct message once the game has already started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T23:00:00.000Z')); // after 22:00 UTC start
    render(<WeeklyTimeline phase="played" gameDate="2026-07-10" gameTime="18:00" status="closed" />);
    expect(screen.getByText(/game has started/i)).toBeInTheDocument();
  });

  it('shows the "registration opens" status line before the scheduled Monday open, even if status is already open (created early)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z')); // Friday before the target Friday 2026-07-10's week
    render(<WeeklyTimeline phase="before" gameDate="2026-07-10" gameTime="18:00" status="open" />);
    // status is 'open' ahead of the computed Monday, but signups are gated on
    // the window too (signupFlow), so telling a player registration is open
    // would be wrong — they'd be refused.
    expect(screen.getByText(/registration opens mon/i)).toBeInTheDocument();
  });
});

/**
 * Dots are moments, lines are periods.
 *
 * Two bugs live here. The first painted 'done' and 'current' the same green,
 * so a finished milestone and the pending one were indistinguishable. The fix
 * for that introduced the second: an amber "current" dot, which always landed
 * on the milestone that had NOT happened yet and so read as "Registration
 * Closes is happening now" while registration was merely open.
 */
describe('WeeklyTimeline milestone marks', () => {
  function dotClasses(container: HTMLElement): string[] {
    return [...container.querySelectorAll('div.h-3.w-3')].map((d) => d.className);
  }
  function lineClasses(container: HTMLElement): string[] {
    return [...container.querySelectorAll('div.h-0\\.5')].map((d) => d.className);
  }

  const WEEK = { gameDate: '2026-07-10', gameTime: '18:00' } as const;

  // Sweeping every phase rather than a handful of timestamps: the phase is now
  // the whole input, so this covers the component's entire state space.
  const ALL_PHASES = ['before', 'open', 'closed', 'locked', 'played'] as const;

  it('never puts amber on a dot, in any phase: a moment has either happened or it has not', () => {
    for (const phase of ALL_PHASES) {
      const { container, unmount } = render(<WeeklyTimeline {...WEEK} status="open" phase={phase} />);
      expect(dotClasses(container).filter((c) => c.includes('amber')), phase).toHaveLength(0);
      unmount();
    }
  });

  it('marks at most one stretch of the week as in progress, in any phase', () => {
    for (const phase of ALL_PHASES) {
      const { container, unmount } = render(<WeeklyTimeline {...WEEK} status="open" phase={phase} />);
      expect(lineClasses(container).filter((c) => c.includes('amber')).length, phase).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it('before the week starts: nothing has happened, nothing is in progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    const { container } = render(<WeeklyTimeline phase="before" {...WEEK} status="closed" />);

    expect(dotClasses(container).every((c) => c.includes('ring-slate-300'))).toBe(true);
    expect(lineClasses(container).every((c) => c.includes('slate'))).toBe(true);
  });

  it('while registration is open: the opening is done and the registration stretch is amber', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T18:00:00.000Z')); // Monday afternoon
    const { container } = render(<WeeklyTimeline phase="open" {...WEEK} status="open" />);

    const [opens, closes, game] = dotClasses(container);
    expect(opens).toContain('green');
    expect(closes).toContain('ring-slate-300'); // hasn't happened yet
    expect(game).toContain('ring-slate-300');

    const [registration, preGame] = lineClasses(container);
    expect(registration).toContain('amber'); // the stretch we're in
    expect(preGame).toContain('slate');
  });

  it('after the close, before the game: both registration dots green, the wait is amber', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z')); // Thursday
    const { container } = render(<WeeklyTimeline phase="closed" {...WEEK} status="closed" />);

    const [opens, closes, game] = dotClasses(container);
    expect(opens).toContain('green');
    expect(closes).toContain('green');
    expect(game).toContain('ring-slate-300');

    const [registration, preGame] = lineClasses(container);
    expect(registration).toContain('green'); // that stretch is over
    expect(preGame).toContain('amber');
  });

  it('once the game has started every mark is green', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T23:00:00.000Z'));
    const { container } = render(<WeeklyTimeline phase="played" {...WEEK} status="closed" />);

    expect(dotClasses(container).every((c) => c.includes('green'))).toBe(true);
    expect(lineClasses(container).every((c) => c.includes('green'))).toBe(true);
  });

  it('an early-opened session still reads as not yet open, matching what signups do', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    const { container } = render(<WeeklyTimeline phase="before" {...WEEK} status="open" />);

    // The old status-driven version showed this as already opened, which
    // contradicted the window gate that would refuse the signup.
    expect(dotClasses(container)[0]).toContain('ring-slate-300');
  });
});
