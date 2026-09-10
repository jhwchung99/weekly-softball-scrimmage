// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionLocation } from '../SessionLocation';

/**
 * Untested until now, and it renders the one detail people actually need on
 * the day. Its whole job is degrees of certainty: the area is known when the
 * week is created, but the diamond is not booked until after registration
 * closes, so this has to say something useful at both points.
 */
describe('SessionLocation', () => {
  it('renders nothing at all when no area has been set', () => {
    // Not an empty placeholder — a blank line under the date reads as a
    // missing value rather than a decision not yet made.
    const { container } = render(<SessionLocation locationArea="" locationName="" locationUrl="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the area is settled and the field is not, before the permit is booked', () => {
    render(<SessionLocation locationArea="Mississauga" locationName="" locationUrl="" />);
    expect(screen.getByText('Mississauga (specific field TBD)')).toBeInTheDocument();
  });

  it('names the diamond once it is booked', () => {
    render(<SessionLocation locationArea="Mississauga" locationName="Iceland Diamond 3" locationUrl="" />);
    expect(screen.getByText('Iceland Diamond 3, Mississauga')).toBeInTheDocument();
  });

  it('links to the map when there is one, and opens it safely', () => {
    render(
      <SessionLocation
        locationArea="Mississauga"
        locationName="Iceland Diamond 3"
        locationUrl="https://maps.example.test/x"
      />
    );

    const link = screen.getByRole('link', { name: 'Iceland Diamond 3, Mississauga' });
    expect(link).toHaveAttribute('href', 'https://maps.example.test/x');
    // Opening in a new tab without this hands the map page a window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('is plain text when no map link exists', () => {
    render(<SessionLocation locationArea="Mississauga" locationName="Iceland Diamond 3" locationUrl="" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('reads as settled once the field is known, and provisional before', () => {
    // The colour is the only cue that "Mississauga (specific field TBD)" is
    // not the final answer.
    const { container: pending } = render(<SessionLocation locationArea="Mississauga" locationName="" locationUrl="" />);
    const { container: booked } = render(
      <SessionLocation locationArea="Mississauga" locationName="Iceland Diamond 3" locationUrl="" />
    );

    expect(pending.firstElementChild?.className).toContain('text-slate-500');
    expect(booked.firstElementChild?.className).toContain('text-slate-700');
  });
});
