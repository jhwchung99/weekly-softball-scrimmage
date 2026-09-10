// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddSignupForm, CreateSessionForm } from '../admin/page';

/**
 * Neither of these was exported, so nothing could render them and nothing did.
 * `AddSignupForm` writes the waiver record that the app's whole audit-trail
 * claim rests on, and `CreateSessionForm` decides the defaults every new week
 * starts from.
 */

const fetchMock = vi.fn();

/** The JSON body of the last request the form sent. */
function lastBody() {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return JSON.parse(String(init.body));
}

function lastUrl() {
  return String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[0]);
}

const handlers = () => ({ busy: false, setBusy: vi.fn(), setError: vi.fn() });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ signup: { signupId: 's1' }, session: { sessionId: '2026-07-10' } }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('AddSignupForm', () => {
  const props = () => ({ ...handlers(), sessionId: '2026-07-10', onAdded: vi.fn() });

  it('records the waiver as accepted, which is the audit trail the app claims to keep', async () => {
    // The organizer is adding someone who agreed in person; the app records
    // that agreement rather than leaving the field blank.
    render(<AddSignupForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'kevin@dummy.test');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(lastBody().waiverAccepted).toBe(true);
  });

  it('adds the player to the session being viewed', async () => {
    render(<AddSignupForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'kevin@dummy.test');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(lastUrl()).toContain('/api/admin/sessions/2026-07-10/signups');
    expect(lastBody().email).toBe('kevin@dummy.test');
  });

  it('sends no profile for someone who already has one', async () => {
    // Sending an empty profile would overwrite the name and positions they
    // saved themselves.
    render(<AddSignupForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'kevin@dummy.test');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(lastBody()).not.toHaveProperty('profile');
  });

  it('sends a profile when the organizer says the player has none yet', async () => {
    render(<AddSignupForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'new@dummy.test');
    await userEvent.click(screen.getByLabelText(/no saved profile/i));
    await userEvent.type(screen.getByLabelText('Full name'), 'New Player');
    // Gender is required on this branch of the form.
    await userEvent.click(screen.getByRole('radio', { name: 'Male' }));
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(lastBody().profile).toMatchObject({ fullName: 'New Player', gender: 'Male' });
  });

  it('sends no guest fields for a member', async () => {
    render(<AddSignupForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'kevin@dummy.test');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    const body = lastBody();
    expect(body).not.toHaveProperty('invitedByName');
    expect(body).not.toHaveProperty('willingToShare');
  });

  it('names the inviter when the organizer marks someone a guest', async () => {
    render(<AddSignupForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'guest@dummy.test');
    await userEvent.click(screen.getByLabelText(/guest/i));
    await userEvent.type(screen.getByLabelText('Invited by (member name)'), 'Kevin Kim');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(lastBody().invitedByName).toBe('Kevin Kim');
  });

  it('tells the console to reload once the player is added', async () => {
    const p = props();
    render(<AddSignupForm {...p} />);

    await userEvent.type(screen.getByLabelText('Email'), 'kevin@dummy.test');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(p.onAdded).toHaveBeenCalled();
  });

  it('reports a refusal instead of pretending it worked', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "You're already signed up for this week" }) });
    const p = props();
    render(<AddSignupForm {...p} />);

    await userEvent.type(screen.getByLabelText('Email'), 'kevin@dummy.test');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(p.setError).toHaveBeenCalledWith("You're already signed up for this week");
    expect(p.onAdded).not.toHaveBeenCalled();
  });
});

describe('CreateSessionForm', () => {
  const props = () => ({ ...handlers(), onCreated: vi.fn() });

  it('starts a new week from the league defaults', async () => {
    render(<CreateSessionForm {...props()} />);

    expect(screen.getByLabelText('Time')).toHaveValue('18:00');
    expect(screen.getByLabelText('Capacity')).toHaveValue(20);
    expect(screen.getByLabelText('Permit cost ($)')).toHaveValue(0);
    expect(screen.getByLabelText('Price/spot ($)')).toHaveValue(10);
  });

  it('sends what the organizer entered', async () => {
    render(<CreateSessionForm {...props()} />);

    await userEvent.type(screen.getByLabelText('Date'), '2026-07-10');
    await userEvent.clear(screen.getByLabelText('Capacity'));
    await userEvent.type(screen.getByLabelText('Capacity'), '24');
    await userEvent.type(screen.getByLabelText('Area'), 'Mississauga');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    // Numbers on the wire, not the strings the inputs hold.
    expect(lastBody()).toMatchObject({ gameDate: '2026-07-10', capacity: 24, locationArea: 'Mississauga' });
  });

  it('hands the console the new session so it opens straight onto it', async () => {
    const p = props();
    render(<CreateSessionForm {...p} />);

    await userEvent.type(screen.getByLabelText('Date'), '2026-07-10');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(p.onCreated).toHaveBeenCalledWith('2026-07-10');
  });

  it('reports a rejected date rather than appearing to succeed', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'gameDate must fall on a Friday, Saturday, or Sunday.' }) });
    const p = props();
    render(<CreateSessionForm {...p} />);

    await userEvent.type(screen.getByLabelText('Date'), '2026-07-08');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(p.setError).toHaveBeenCalledWith(expect.stringMatching(/Friday, Saturday, or Sunday/));
    expect(p.onCreated).not.toHaveBeenCalled();
  });
});
