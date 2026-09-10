import { describe, it, expect, vi, beforeEach } from 'vitest';
import { asJson, failureMessage, sendApiRequest } from '../apiRequest';

/**
 * One request policy, where there were two copies of the described half and
 * four hand-rolled versions of the rest.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function respond(ok: boolean, body: unknown) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

const request = { url: '/api/thing', init: { method: 'POST' }, fallbackError: 'Thing failed' };

describe('failureMessage', () => {
  it("prefers the server's own words, which are written for whoever is looking", () => {
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
    // The four hand-rolled call sites used `body?.error || fallback`, which
    // put "[object Object]" in front of the reader instead.
    expect(failureMessage({ error: { code: 500 } }, 'Cancel failed')).toBe('Cancel failed');
  });
});

describe('asJson', () => {
  it('posts by default, since most of these do', () => {
    const init = asJson({ a: 1 });
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('takes another method when the route wants one', () => {
    expect(asJson({}, 'PATCH').method).toBe('PATCH');
  });
});

describe('sendApiRequest', () => {
  it('returns the parsed body on success', async () => {
    respond(true, { session: { sessionId: '2026-07-10' } });

    await expect(sendApiRequest(request)).resolves.toEqual({ session: { sessionId: '2026-07-10' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/thing', { method: 'POST' });
  });

  it("throws the server's message on failure", async () => {
    respond(false, { error: 'Registration has closed for this week.' });

    await expect(sendApiRequest(request)).rejects.toThrow('Registration has closed for this week.');
  });

  it('throws the fallback when the failure says nothing', async () => {
    respond(false, {});

    await expect(sendApiRequest(request)).rejects.toThrow('Thing failed');
  });

  it('survives a response that is not JSON at all', async () => {
    // A 500 from the platform is an HTML error page, not a body with an
    // `error` field. That has to produce the fallback, not a parse error.
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    await expect(sendApiRequest(request)).rejects.toThrow('Thing failed');
  });

  it('lets a network failure through as itself', async () => {
    // Offline is not a refusal, and dressing it as one would hide it.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(sendApiRequest(request)).rejects.toThrow('Failed to fetch');
  });
});
