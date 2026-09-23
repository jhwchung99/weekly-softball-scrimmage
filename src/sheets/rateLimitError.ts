// Split from client.ts so apiErrors can recognise the quota without loading
// the Sheets client (and the googleapis package) into every route.

/**
 * Per-minute limits, which is what waiting a few seconds actually fixes.
 *
 * `quotaExceeded` is deliberately absent: on Sheets it usually means the
 * *daily* allowance, and retrying that spends seven seconds to fail anyway.
 */
const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

type GoogleApiError = {
  status?: number;
  code?: number;
  errors?: { reason?: string }[];
  response?: { data?: { error?: { errors?: { reason?: string }[] } } };
};

/**
 * Whether this failure is the quota, and so worth waiting out.
 *
 * 429 is the documented answer and the one the retry was written for. Sheets
 * also returns **403 with reason `rateLimitExceeded`** for the per-user
 * per-minute quota, which is the limit this app is most likely to hit — one
 * service account carries all its traffic. Those were bypassing the retry
 * entirely while the retry's comment in client.ts claimed to cover them.
 *
 * The reason is checked rather than the status alone, because a plain 403 is
 * usually "this service account cannot see that spreadsheet" — a permission
 * error that will fail identically in seven seconds' time.
 */
export function isRateLimitError(err: unknown): boolean {
  const e = err as GoogleApiError | undefined;
  const status = e?.status ?? e?.code;
  if (status === 429) return true;
  if (status !== 403) return false;

  const reasons = e?.errors ?? e?.response?.data?.error?.errors ?? [];
  return reasons.some((r) => (r?.reason ? RETRYABLE_REASONS.has(r.reason) : false));
}
