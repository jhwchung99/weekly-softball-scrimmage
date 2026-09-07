import { getRedis } from './redis';

/**
 * A fixed-window counter, keyed per caller.
 *
 * Added for the feedback endpoint, which is the app's only route that
 * lets an arbitrary signed-in user put arbitrary text on the organizer's
 * phone — without a cap, one person could ring it all night.
 *
 * Fails OPEN when Upstash isn't configured, matching withMutationLock:
 * local dev and preview deploys shouldn't lose the feature outright. The
 * exposure that leaves is bounded by the endpoint still requiring a
 * signed-in Google account, so it is never anonymous.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  const fullKey = `weekly-softball-scrimmage:ratelimit:${key}`;
  const count = await redis.incr(fullKey);

  if (count === 1) {
    await redis.expire(fullKey, windowSeconds);
  } else if ((await redis.ttl(fullKey)) < 0) {
    // A crash between the INCR and the EXPIRE above would otherwise leave a
    // key with no TTL, locking that person out of the feature permanently.
    await redis.expire(fullKey, windowSeconds);
  }

  return count <= limit;
}
