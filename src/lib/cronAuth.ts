import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './apiErrors';

/**
 * Cron routes are hit by GitHub Actions, not a logged-in user — a shared
 * secret header stands in for a session. The secret needs to be set as a
 * GitHub Actions repo secret (sent as a header) and the same value here
 * as CRON_SECRET, both matching what's eventually on Vercel (Step 14).
 */
export function requireCronSecret(request: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new ApiError(500, 'CRON_SECRET is not configured on the server.');

  const provided = request.headers.get('x-cron-secret') ?? '';
  // Constant-time comparison — a plain !== leaks how many leading bytes
  // matched via response timing. timingSafeEqual throws on a length
  // mismatch, so that's checked separately first.
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  const matches = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  if (!matches) throw new ApiError(401, 'Invalid or missing cron secret.');
}
