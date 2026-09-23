// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddToCalendar } from '../AddToCalendar';

describe('AddToCalendar', () => {
  // Without the id the route serves the soonest game, so every card in a week
  // with two games downloaded the first one under the second one's filename.
  it('asks for this card\'s game in the .ics link', () => {
    render(<AddToCalendar gameDate="2026-07-12" gameTime="18:00" locationArea="" locationName="" locationUrl="" />);

    expect(screen.getByRole('link', { name: '.ics' }).getAttribute('href')).toBe('/api/calendar?sessionId=2026-07-12');
  });
});
