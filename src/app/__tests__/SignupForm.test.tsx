// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupForm } from '../page';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
  );
});

function renderForm() {
  return render(
    <SignupForm
      sessionId="2099-01-01"
      savedPositions="Catcher"
      waiverText="I agree to the terms."
      busy={false}
      setBusy={vi.fn()}
      setError={vi.fn()}
      onSignedUp={vi.fn()}
    />
  );
}

describe('SignupForm', () => {
  it('hides the guest fields by default', () => {
    renderForm();
    expect(screen.queryByLabelText(/which member invited you/i)).not.toBeInTheDocument();
  });

  it('reveals invitedByName and willingToShare when the guest checkbox is checked', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('checkbox', { name: /i'm a guest/i }));
    expect(screen.getByLabelText(/which member invited you/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /willing to share/i })).toBeInTheDocument();
  });

  it('disables submit until the waiver checkbox is checked', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeDisabled();
  });

  it('submits the member-path body shape (no invitedByName/willingToShare)', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ waiverAccepted: true });
  });

  it('submits the guest-path body shape with invitedByName and willingToShare', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('checkbox', { name: /i'm a guest/i }));
    await userEvent.type(screen.getByLabelText(/which member invited you/i), 'Some Member');
    await userEvent.click(screen.getByRole('checkbox', { name: /willing to share/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/sessions/2099-01-01/signup');
    expect(JSON.parse(init.body)).toEqual({
      waiverAccepted: true,
      invitedByName: 'Some Member',
      willingToShare: true,
    });
  });
});
