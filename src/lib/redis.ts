import { Redis } from '@upstash/redis';

let redisClient: Redis | undefined;
let warnedNotConfigured = false;

/**
 * The shared Upstash client, or null when Upstash isn't configured.
 *
 * Returns null rather than throwing because "no Redis" means something
 * different to each caller, and each one degrades on its own terms: the
 * mutation lock runs unlocked (lock.ts), the rate limiter lets requests
 * through (rateLimit.ts). Both document why that tradeoff is acceptable
 * for them; neither should take the whole app down over a missing
 * optional dependency.
 */
export function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedNotConfigured) {
      console.warn(
        'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set — mutation requests are running ' +
          'unlocked and the feedback rate limiter is inactive. See ' +
          'planner/2026-09-04-profile-edit-rate-limiting-testing-plan.md for setup.'
      );
      warnedNotConfigured = true;
    }
    return null;
  }
  redisClient = new Redis({ url, token });
  return redisClient;
}
