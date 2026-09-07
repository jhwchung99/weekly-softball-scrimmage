// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from '../page';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
  );
});

describe('ProfileForm', () => {
  it('renders empty fields by default (first-time signup)', () => {
    render(<ProfileForm onSaved={vi.fn()} busy={false} setBusy={vi.fn()} setError={vi.fn()} />);
    expect(screen.getByLabelText('Full name')).toHaveValue('');
    // Gender is a two-option radio group now, so nothing is pre-selected
    // for a first-time player rather than an empty text box.
    expect(screen.getByRole('radio', { name: 'Male' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Female' })).not.toBeChecked();
    expect(screen.getByText(/first time here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save and continue/i })).toBeInTheDocument();
  });

  it('pre-fills from initialValues when editing an existing profile', () => {
    render(
      <ProfileForm
        initialValues={{ fullName: 'Jane Doe', gender: 'Female', savedPositions: 'Catcher, SS' }}
        onSaved={vi.fn()}
        busy={false}
        setBusy={vi.fn()}
        setError={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Full name')).toHaveValue('Jane Doe');
    expect(screen.getByRole('radio', { name: 'Female' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Male' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Catcher' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SS' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Outfield' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('shows a Cancel button only when onCancel is provided, and calls it', async () => {
    const onCancel = vi.fn();
    const { rerender } = render(<ProfileForm onSaved={vi.fn()} busy={false} setBusy={vi.fn()} setError={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    rerender(<ProfileForm onSaved={vi.fn()} onCancel={onCancel} busy={false} setBusy={vi.fn()} setError={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('allows only one gender at a time, and swaps rather than accumulating', async () => {
    render(<ProfileForm onSaved={vi.fn()} busy={false} setBusy={vi.fn()} setError={vi.fn()} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Male' }));
    expect(screen.getByRole('radio', { name: 'Male' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Female' }));
    expect(screen.getByRole('radio', { name: 'Female' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Male' })).not.toBeChecked();
  });

  it('submits the entered values to PUT /api/players/me', async () => {
    const onSaved = vi.fn();
    render(<ProfileForm onSaved={onSaved} busy={false} setBusy={vi.fn()} setError={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Full name'), 'New Player');
    await userEvent.click(screen.getByRole('radio', { name: 'Male' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rover' }));
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      '/api/players/me',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ fullName: 'New Player', gender: 'Male', savedPositions: 'Rover' }),
      })
    );
  });
});
