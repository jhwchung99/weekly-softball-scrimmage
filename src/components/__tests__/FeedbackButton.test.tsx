// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackButton } from '../FeedbackButton';

const authStatus = { current: 'authenticated' as 'authenticated' | 'unauthenticated' };
const signIn = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: authStatus.current }), signIn }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authStatus.current = 'authenticated';
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  vi.stubGlobal('fetch', fetchMock);
});

function body() {
  return JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
}

describe('FeedbackButton', () => {
  it('starts collapsed to a single line', () => {
    render(<FeedbackButton />);
    expect(screen.getByRole('button', { name: /report a bug or send feedback/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('opens the form when clicked', async () => {
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /something is broken/i })).toBeChecked();
  });

  it('posts the message, the chosen kind, and the current page', async () => {
    window.history.pushState({}, '', '/guidelines');
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Cancel does nothing.');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/feedback');
    expect(body()).toEqual({ kind: 'bug', message: 'Cancel does nothing.', pageUrl: '/guidelines' });
  });

  it('sends the suggestion kind when that radio is picked', async () => {
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));
    await userEvent.click(screen.getByRole('radio', { name: /suggestion or comment/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Show positions on the roster.');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body().kind).toBe('feedback');
  });

  it('confirms once sent, and stops showing the form', async () => {
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Something broke.');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/sent, thank you/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it("surfaces the server's message when the send is refused", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "You've sent a few reports already." }) });
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));
    await userEvent.type(screen.getByRole('textbox'), 'Something broke.');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/sent a few reports already/i)).toBeInTheDocument();
    // The text survives the failure, so nobody has to retype it to retry.
    expect(screen.getByRole('textbox')).toHaveValue('Something broke.');
  });

  it('asks a signed-out visitor to sign in instead of offering the form', async () => {
    authStatus.current = 'unauthenticated';
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));

    expect(screen.getByText(/please sign in first/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('will not send an empty message', async () => {
    render(<FeedbackButton />);
    await userEvent.click(screen.getByRole('button', { name: /report a bug or send feedback/i }));
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});

/**
 * This is the one widget on every page, and it is the one a player reaches
 * *because* something already went wrong — so a reader who cannot see it has
 * the worst possible reason to be stuck in it.
 */
describe('FeedbackButton accessibility', () => {
  const trigger = () => screen.getByRole('button', { name: /report a bug or send feedback/i });

  it('says whether it is open, and what it controls', async () => {
    render(<FeedbackButton />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-controls', 'feedback-panel');

    await userEvent.click(trigger());
    expect(document.getElementById('feedback-panel')).toBeInTheDocument();
  });

  it('moves focus into the panel it opened', async () => {
    // Opening replaces the trigger, so the focused element is destroyed. Not
    // moving focus leaves the reader at the top of the document, having
    // apparently pressed a button that did nothing.
    render(<FeedbackButton />);
    await userEvent.click(trigger());

    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('feedback-panel')));
  });

  it('gives focus back to the trigger on close', async () => {
    render(<FeedbackButton />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it('names the panel by its heading', async () => {
    render(<FeedbackButton />);
    await userEvent.click(trigger());

    const panel = document.getElementById('feedback-panel')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('feedback-heading');
    expect(document.getElementById('feedback-heading')).toHaveTextContent(/report a bug or send feedback/i);
  });

  it('announces a failure, since the send button looks unchanged either way', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Too many messages.' }) });
    render(<FeedbackButton />);
    await userEvent.click(trigger());
    await userEvent.type(screen.getByRole('textbox'), 'It broke');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many messages.');
  });

  it('announces the confirmation, since the form it replaces is gone', async () => {
    render(<FeedbackButton />);
    await userEvent.click(trigger());
    await userEvent.type(screen.getByRole('textbox'), 'It broke');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/sent, thank you/i);
  });

  it('offers a way out of the signed-out dead end', async () => {
    // It used to say "please sign in first" and give the reader nothing to
    // sign in with.
    authStatus.current = 'unauthenticated';
    render(<FeedbackButton />);
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }));
    expect(signIn).toHaveBeenCalledWith('google');
  });
});
