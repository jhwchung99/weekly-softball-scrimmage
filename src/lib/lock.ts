import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getRedis } from './redis';
import { ApiError } from './apiErrors';

// Serializes every signup/cancel/sub-request mutation across all
// concurrent requests, globally — this is what actually closes a real
// race condition in capacity assignment (two simultaneous signups could
// otherwise both read "room available" and both get confirmed,
// oversubscribing capacity) and smooths Sheets API quota bursts, while
// keeping every mutation route fully synchronous: same validation
// errors, same response shape as without this.
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
// and a second request starts mutating alongside the first, losing the mutual
// exclusion this exists for.
//
// Raised from 60s once the admin session revision became a single hold: that
// flow makes ~9 sequential Sheets calls (a rekey, a field write, and the
// promotion cascade), and withRateLimitRetry can sleep 7s on each, so its
// worst case is ~63s — over the old ceiling. It had already been raised once
// before, from 15s, for the same reason.
//
// lib/__tests__/lockBudget.test.ts measures the call count of that flow and
// fails if it outgrows this value again, so the number is checked rather than
// remembered. See ADR-0001.
export const LOCK_TTL_SECONDS = 120;
const ACQUIRE_RETRY_DELAY_MS = 250;
const ACQUIRE_TIMEOUT_MS = 10000;

/**
 * Whether the current async call path is already inside a hold.
 *
 * This is what lets each mutating flow guard itself instead of trusting every
 * route to remember. Flows compose — the teams cron calls `generateTeamsIfDue`
 * which calls `generateTeams`; revising a session reschedules and then runs the
 * promotion cascade — so once each takes the lock for itself, an outer hold
 * will routinely contain an inner one.
 *
 * Without this, that is not a race but a guaranteed deadlock: the inner
 * acquire spins against the key its own caller is holding until the acquire
 * timeout elapses, then 503s. AsyncLocalStorage scopes the flag to one request's
 * async path, so concurrent requests never see each other's.
 */
const insideHold = new AsyncLocalStorage<true>();

/**
 * Runs `fn` while holding the single global mutation lock. Fails open
 * (runs `fn` unlocked) if Redis isn't configured yet, rather than
 * breaking every mutation route before Upstash credentials exist — the
 * race-condition/quota-burst risk this closes simply stays open until
 * then, same as it is today without this file.
 *
 * Reentrant: nesting one call inside another runs the inner work under the
 * outer hold rather than acquiring again, and the lock is released once, when
 * the outermost call finishes. Two *separate* top-level operations still
 * serialize against each other exactly as before — the flag follows one async
 * path, not the process.
 */
export async function withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  // The caller already holds it; acquiring again would spin against our own key.
  if (insideHold.getStore()) return fn();

  const redis = getRedis();
  if (!redis) return fn();

  const token = randomUUID();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const acquired = await redis.set(LOCK_KEY, token, { nx: true, ex: LOCK_TTL_SECONDS });
    if (acquired === 'OK') {
      try {
        return await insideHold.run(true, fn);
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
  throw new ApiError(503, 'The server is busy processing other requests. Please try again in a moment.');
}
