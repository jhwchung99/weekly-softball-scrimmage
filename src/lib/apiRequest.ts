/**
 * How this app's browser code talks to its own API.
 *
 * The two pages had a request policy each, and they were the same policy:
 * describe the request, send it, and on failure raise the server's own
 * message. `failureMessage` and `adminFailureMessage` were byte-for-byte
 * identical, and so were the `ActionRequest`/`AdminRequest` types and the two
 * JSON-body helpers.
 *
 * Worse, only the four *described* requests used any of it. Four more — save
 * profile, sign up, create session, add signup — hand-rolled `fetch` and
 * unwrapped errors as `(await res.json())?.error || fallback`, which is not
 * the same thing: an `error` that is an object rather than a string reaches
 * the user as "[object Object]" instead of the fallback. The seam was named,
 * demonstrated, and half-applied.
 *
 * Nothing here touches React or the DOM. `sendApiRequest` is the only part
 * that touches the network, so everything above it stays testable as data.
 */

/** One request this app makes to its own API. */
export interface ApiRequest {
  url: string;
  init: RequestInit;
  /** Shown when the server fails without saying why. */
  fallbackError: string;
}

/** A JSON-bodied request. Defaults to POST, since most of them are. */
export function asJson(body: unknown, method: string = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * What to tell the reader when a request fails.
 *
 * The server's own message when it sent one — those are written for whoever
 * is looking ("You're already signed up for this week", "Kevin Kim already has
 * an active signup for this session") and are far better than anything
 * generic. The fallback covers a failure with no usable body, which is a
 * network or infrastructure problem rather than a refusal.
 *
 * A non-string `error` falls back too, rather than being interpolated into a
 * sentence as "[object Object]".
 */
export function failureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error ? error : fallback;
}

/**
 * Sends one request and returns its parsed body, throwing the server's message
 * if it failed.
 *
 * The body is parsed either way: callers need it on success (the new session
 * id after a reschedule) and `failureMessage` needs it on failure. A body that
 * is not JSON at all becomes `{}`, so a 500 with an HTML error page still
 * produces the fallback rather than a parse error.
 */
export async function sendApiRequest({ url, init, fallbackError }: ApiRequest): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(failureMessage(body, fallbackError));
  return body;
}
