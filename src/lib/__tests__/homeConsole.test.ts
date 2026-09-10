import { describe, it, expect } from 'vitest';
import { requestFor, failureMessage, type PlayerAction } from '../homeConsole';

/**
 * The homepage's request policy was four near-identical handlers closed over
 * React state, so nothing could reach it. These check the part that decides
 * where a request goes and what the player is told when it fails.
 */

/** The parsed JSON body of a request, or null when it carries none. */
function bodyOf(action: PlayerAction) {
  const { init } = requestFor(action);
  return init.body ? JSON.parse(String(init.body)) : null;
}

describe('requestFor', () => {
  it('cancels a signup by posting to its cancel path', () => {
    const { url, init } = requestFor({ kind: 'cancel', signupId: 's1' });

    expect(url).toBe('/api/signups/s1/cancel');
    expect(init.method).toBe('POST');
  });

  it('asks to share a spot, naming the target', () => {
    const action: PlayerAction = { kind: 'requestSub', signupId: 's1', targetEmail: 'target@dummy.test' };

    expect(requestFor(action).url).toBe('/api/signups/s1/sub-request');
    expect(bodyOf(action)).toEqual({ targetEmail: 'target@dummy.test' });
  });

  it('withdraws a request by deleting it, not by posting again', () => {
    const { url, init } = requestFor({ kind: 'cancelSubRequest', signupId: 's1' });

    expect(url).toBe('/api/signups/s1/sub-request');
    expect(init.method).toBe('DELETE');
  });

  it('answers someone else’s request against their signup, not the responder’s', () => {
    // The path carries the asker's id: answering acts on their request.
    const { url } = requestFor({ kind: 'respondToSubRequest', fromSignupId: 'asker-1', accept: true });

    expect(url).toBe('/api/signups/asker-1/sub-request/respond');
  });

  it('carries the answer, so declining is not mistaken for accepting', () => {
    expect(bodyOf({ kind: 'respondToSubRequest', fromSignupId: 'a', accept: true })).toEqual({ accept: true });
    expect(bodyOf({ kind: 'respondToSubRequest', fromSignupId: 'a', accept: false })).toEqual({ accept: false });
  });

  it('encodes an id rather than pasting it into the path', () => {
    // Ids are UUIDs today, so nothing needs escaping in practice — which is
    // exactly why it would go unnoticed if it stopped happening.
    expect(requestFor({ kind: 'cancel', signupId: 'a/b?c' }).url).toBe('/api/signups/a%2Fb%3Fc/cancel');
  });

  it('sends JSON where it sends a body, and no body where it does not', () => {
    expect(requestFor({ kind: 'requestSub', signupId: 's1', targetEmail: 'x@y.test' }).init.headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect(requestFor({ kind: 'cancel', signupId: 's1' }).init.body).toBeUndefined();
  });
});

describe('failureMessage', () => {
  it('prefers the server’s own words, which are written for players', () => {
    expect(failureMessage({ error: "You're already signed up for this week" }, 'Cancel failed')).toBe(
      "You're already signed up for this week"
    );
  });

  it('falls back when the response carries no message', () => {
    // A failure with no body is a network or infrastructure problem rather
    // than a refusal, and there is nothing better to say.
    expect(failureMessage({}, 'Cancel failed')).toBe('Cancel failed');
    expect(failureMessage(null, 'Request failed')).toBe('Request failed');
    expect(failureMessage(undefined, 'Response failed')).toBe('Response failed');
  });

  it('falls back rather than showing an empty line', () => {
    expect(failureMessage({ error: '' }, 'Cancel failed')).toBe('Cancel failed');
  });

  it('falls back when the error is not a string', () => {
    expect(failureMessage({ error: { code: 500 } }, 'Cancel failed')).toBe('Cancel failed');
  });

  it('gives each action its own fallback, so a failure says which one failed', () => {
    expect(requestFor({ kind: 'cancel', signupId: 's1' }).fallbackError).toBe('Cancel failed');
    expect(requestFor({ kind: 'requestSub', signupId: 's1', targetEmail: 'x@y.test' }).fallbackError).toBe('Request failed');
    expect(requestFor({ kind: 'respondToSubRequest', fromSignupId: 'a', accept: true }).fallbackError).toBe('Response failed');
  });
});
