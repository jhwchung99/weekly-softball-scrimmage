'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Bug, CheckCircle2, Loader2, MessageSquare, Send } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABELS, FeedbackKind, MAX_FEEDBACK_LENGTH } from '../lib/feedbackKinds';

/** Ties the trigger's aria-controls to the panel it opens, and that panel to
 * the heading naming it. */
const PANEL_ID = 'feedback-panel';
const HEADING_ID = 'feedback-heading';

const KIND_ICONS: Record<FeedbackKind, typeof Bug> = {
  bug: Bug,
  feedback: MessageSquare,
};

/**
 * Sends a bug report or suggestion straight to the organizer's phone as a
 * push (see api/feedback). Rendered site-wide from the root layout,
 * because the whole point is being reachable from whichever page went
 * wrong, and it reports that page's path along with the message.
 *
 * Collapsed to a single line until opened: it should be findable without
 * competing with the week's actual signup information.
 */
export function FeedbackButton() {
  const { status: authStatus } = useSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  // Focus follows the disclosure both ways. Opening this *replaces* the
  // trigger with a panel, so a keyboard or screen-reader user who is not moved
  // into it lands wherever the browser decides — usually the top of the
  // document, having apparently pressed a button that did nothing.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    } else if (returnFocus.current) {
      // Only after an explicit close, never on first render.
      triggerRef.current?.focus();
      returnFocus.current = false;
    }
  }, [open]);

  function close() {
    returnFocus.current = true;
    setOpen(false);
    setError('');
    setSent(false);
    setMessage('');
    setKind('bug');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message, pageUrl: window.location.pathname }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not send that.');
      setSent(true);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mx-auto max-w-xl px-4 pb-10">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={false}
          aria-controls={PANEL_ID}
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600 hover:underline"
        >
          <Bug className="h-3.5 w-3.5 shrink-0" />
          Report a bug or send feedback
        </button>
      </div>
    );
  }

  return (
    // tabIndex -1 so focus can be moved here on open without the panel
    // joining the tab order once it has been read.
    <div
      id={PANEL_ID}
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={HEADING_ID}
      className="mx-auto max-w-xl px-4 pb-10 outline-none"
    >
      <Card>
        <h2 id={HEADING_ID} className="flex items-center gap-1.5 font-semibold text-slate-900">
          <Bug className="h-4 w-4" /> Report a bug or send feedback
        </h2>

        {authStatus !== 'authenticated' ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Please sign in first, so the organizer knows who to get back to.
            </p>
            {/* The dead end this used to be: told to sign in, with nothing to
                sign in with. The page's own sign-in button is elsewhere, and
                on some pages there isn't one. */}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => signIn('google')}>
                Sign in with Google
              </Button>
              <Button variant="secondary" size="sm" onClick={close}>
                Close
              </Button>
            </div>
          </>
        ) : sent ? (
          <>
            {/* Announced when it appears: the form it replaces is gone, so
                without this there is no signal that the send worked. */}
            <p role="status" className="mt-2 flex items-start gap-1.5 text-sm text-green-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Sent, thank you. The organizer has been notified.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSent(false)}>
                Send another
              </Button>
              <Button variant="secondary" size="sm" onClick={close}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 space-y-3">
            <fieldset>
              <legend className="text-sm text-slate-700">What kind of message is this?</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {FEEDBACK_KINDS.map((k) => {
                  const Icon = KIND_ICONS[k];
                  return (
                    <label key={k} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="feedback-kind"
                        value={k}
                        checked={kind === k}
                        onChange={() => setKind(k)}
                      />
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {FEEDBACK_KIND_LABELS[k]}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor="feedback-message" className="block text-sm text-slate-700">
                {kind === 'bug' ? 'What went wrong?' : 'What would you change?'}
              </label>
              <textarea
                id="feedback-message"
                rows={4}
                required
                maxLength={MAX_FEEDBACK_LENGTH}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'What you were doing, and what happened instead.'
                    : 'Anything that would make this easier to use.'
                }
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                {message.length}/{MAX_FEEDBACK_LENGTH}. Your email and the page you&apos;re on are included
                automatically.
              </p>
            </div>

            {/* Likewise — the send button stays exactly as it was, so a reader
                who cannot see this text has nothing telling them it failed. */}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !message.trim()}>
                {busy ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Send className="h-3.5 w-3.5" /> Send
                  </span>
                )}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
