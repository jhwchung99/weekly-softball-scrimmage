// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSection } from '../page';

const player = { fullName: 'Jane Doe', gender: 'Female', age: 28, savedPositions: 'Catcher, SS' };

describe('ProfileSection', () => {
  it('shows a read-only summary and an Edit link by default', () => {
    render(<ProfileSection myPlayer={player} busy={false} setBusy={vi.fn()} setError={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Catcher, SS/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('switches to the pre-filled edit form when Edit profile is clicked', async () => {
    render(<ProfileSection myPlayer={player} busy={false} setBusy={vi.fn()} setError={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit profile/i }));

    expect(screen.getByLabelText('Full name')).toHaveValue('Jane Doe');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('returns to view mode without saving when Cancel is clicked', async () => {
    render(<ProfileSection myPlayer={player} busy={false} setBusy={vi.fn()} setError={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit profile/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit profile/i })).toBeInTheDocument();
  });
});
