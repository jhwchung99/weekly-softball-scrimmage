import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { ApiError } from './apiErrors';

// Serializes every signup/cancel/sub-request mutation across all
// concurrent requests, globally — this is what actually closes a real
// race condition in capacity assignment (two simultaneous signups could
// otherwise both read "room available" and both get confirmed,
// oversubscribing capacity) and smooths Sheets API quota bursts, while
// keeping every mutation route fully synchronous: same validation
// errors, same response shape as without this. See
// planner/2026-09-04-profile-edit-rate-limiting-testing-plan.md.
//
// An async queue (originally planned as Upstash QStash) was considered
// and rejected: QStash's model is enqueue-and-process-later via a
// webhook, which would mean today's synchronous validation errors
// ("you're already signed up," "profile required") could only surface
// later through polling, with nowhere in the current schema to carry a
// specific error message back. A lock achieves the same serialization
// with no change to request/response behavior at all.

const LOCK_KEY = 'weekly-softball-scrimmage:mutation-lock';
// Safety valve if a holder crashes before releasing — but it MUST exceed the
// worst-case duration of the work it protects, or the lock expires mid-flight
// and a second request starts mutating alongside the first, losing the
// mutual exclusion this exists for. Worst case here is roughly
// (Sheets calls per mutation) x (rate-limit backoff per call): cancelMySignup
// makes ~6 sequential calls, and withRateLimitRetry sleeps up to 7s on each
// (client.ts, RATE_LIMIT_RETRY_DELAYS_MS) — so 15s was too tight in exactly
// the rate-limited conditions the lock matters most. See
// planner/2026-09-05-code-security-review.md, Bug 5.
const LOCK_TTL_SECONDS = 60;
const ACQUIRE_RETRY_DELAY_MS = 250;
const ACQUIRE_TIMEOUT_MS = 10000;

let redisClient: Redis | undefined;
let warnedNotConfigured = false;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedNotConfigured) {
      console.warn(
        'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set — mutation requests are running ' +
          'unlocked. See planner/2026-09-04-profile-edit-rate-limiting-testing-plan.md for setup.'
      );
      warnedNotConfigured = true;
    }
    return null;
  }
  redisClient = new Redis({ url, token });
  return redisClient;
}

/**
 * Runs `fn` while holding the single global mutation lock. Fails open
 * (runs `fn` unlocked) if Redis isn't configured yet, rather than
 * breaking every mutation route before Upstash credentials exist — the
 * race-condition/quota-burst risk this closes simply stays open until
 * then, same as it is today without this file.
 */
export async function withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return fn();

  const token = randomUUID();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const acquired = await redis.set(LOCK_KEY, token, { nx: true, ex: LOCK_TTL_SECONDS });
    if (acquired === 'OK') {
      try {
        return await fn();
      } finally {
        // Only release if we still hold it — a lock that outlived its
        // TTL and was already reassigned to a new holder shouldn't be
        // deleted out from under them.
        const current = await redis.get<string>(LOCK_KEY);
        if (current === token) {
          await redis.del(LOCK_KEY);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, ACQUIRE_RETRY_DELAY_MS));
  }
  throw new ApiError(503, 'The server is busy processing other requests — please try again in a moment.');
}
