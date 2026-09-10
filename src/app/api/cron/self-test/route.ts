import { NextResponse } from 'next/server';
import { requireCronSecret } from '../../../../lib/cronAuth';
import { getSessionByAnyId } from '../../../../sheets/sessions';
import { listSignupsForSession } from '../../../../sheets/signups';
import { currentWeekGameDayCandidates } from '../../../../lib/time';
import { countConfirmedSpots } from '../../../../lib/payments';
import { getRedis } from '../../../../lib/redis';
import { sendPush } from '../../../../lib/ntfy';
import { sendEmail } from '../../../../lib/gmail';
import { handleApiError } from '../../../../lib/apiErrors';

/**
 * A smoke test for the production notification chain, added 2026-09-08 after
 * a missing headcount push turned out to have four independent causes
 * (unset APP_URL, a dead Gmail refresh token, an over-tight cron window, and
 * a workflow that had never fired) — none of which were visible from
 * anywhere, because every notification call site deliberately swallows its
 * errors so a failed send can't roll back the work that triggered it.
 *
 * Exercises exactly what the real jobs exercise — cron auth, Sheets reads,
 * Redis, ntfy, Gmail — and reports each independently, so a failure names the
 * layer rather than just going quiet.
 *
 * SAFETY, because this runs against production data:
 *   - No Sheets row is written. No session, signup, or player row is touched.
 *     The Redis check writes one throwaway key of its own, on a name no other
 *     code uses and with a few seconds' expiry; it never touches the lock key.
 *   - The email goes to GMAIL_SENDER_EMAIL and nowhere else. A registrant
 *     address is never read, let alone sent to — `to` is not a parameter and
 *     cannot be influenced by the caller.
 *   - The push goes to the organizer's own ntfy topic, same as every other
 *     alert.
 * Running it is therefore safe at any hour, which is the point: the real
 * jobs are all gated to a wall-clock window or have side effects, so none of
 * them can be used to answer "does production actually work right now?".
 */
export async function POST(request: Request) {
  try {
    requireCronSecret(request);

    const startedAt = new Date();
    const checks: Record<string, string> = {};
    // Every check is attempted even if an earlier one failed: the whole
    // value here is learning which layers are broken in one run, rather
    // than fixing one and rediscovering the next on the following attempt.
    const run = async (name: string, fn: () => Promise<string>) => {
      try {
        checks[name] = `ok — ${await fn()}`;
      } catch (err) {
        checks[name] = `FAILED — ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    await run('sheets', async () => {
      const session = await getSessionByAnyId(currentWeekGameDayCandidates(startedAt));
      if (!session) return 'read Sessions tab; no session for this week';
      const signups = await listSignupsForSession(session.sessionId);
      const confirmed = countConfirmedSpots(signups);
      return `session ${session.sessionId} (${session.status}), ${confirmed}/${session.capacity} confirmed, ${signups.length} signup rows`;
    });

    /**
     * Whether the mutation lock is actually running.
     *
     * `getRedis` returns null when Upstash is unconfigured, and the lock and
     * the rate limiter then both **fail open** — deliberately, so a missing
     * optional dependency cannot take the app down. The cost is that the one
     * signal is a `console.warn` in a serverless log nobody reads, and the
     * symptom is two simultaneous signups both reading "there is room" and
     * both being confirmed. That is a week oversubscribed by one, months
     * after the variable went missing.
     *
     * So it round-trips a key rather than checking the variables are present:
     * a URL and a token that are set but wrong fail in exactly the same
     * invisible way as ones that are absent.
     */
    await run('redis', async () => {
      const redis = getRedis();
      if (!redis) {
        throw new Error(
          'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. The mutation lock is running ' +
            'unlocked and the feedback rate limiter is inactive — see ADR-0001.'
        );
      }

      const key = 'weekly-softball-scrimmage:self-test';
      // Prefixed so the token is not valid JSON. `@upstash/redis` parses what
      // it reads back, so a bare timestamp is written as a string and returned
      // as a *number* — which fails a `!==` while printing identically, and
      // reported production as broken when it was fine.
      const token = `self-test-${startedAt.getTime()}`;

      await redis.set(key, token, { ex: 30 });
      const readBack = await redis.get<string>(key);
      await redis.del(key);

      // Compared as text as well, so the check cannot be fooled by that a
      // second time if the value ever stops being prefixed.
      if (String(readBack) !== token) {
        throw new Error(`wrote "${token}" to ${key} but read back ${JSON.stringify(readBack)}`);
      }
      return 'lock store reachable, round-tripped a key';
    });

    await run('ntfy', async () => {
      await sendPush(
        'Self-test',
        `Production self-test at ${startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET. Delivery works.`,
        { priority: 3, tags: ['white_check_mark'] }
      );
      return 'push accepted by ntfy.sh';
    });

    await run('gmail', async () => {
      const to = process.env.GMAIL_SENDER_EMAIL;
      if (!to) throw new Error('Missing GMAIL_SENDER_EMAIL in the environment.');
      await sendEmail(
        to,
        'Softball app: production self-test',
        [
          `Production self-test at ${startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.`,
          '',
          'If you received this, the Gmail refresh token on Vercel is valid and',
          'the app can send mail. No player was contacted.',
        ].join('\n')
      );
      return `sent to the sender address (${to})`;
    });

    const failed = Object.values(checks).filter((v) => v.startsWith('FAILED')).length;
    // 500 when anything failed, so `curl --fail-with-body` in the workflow
    // turns the run red instead of the green-but-did-nothing outcome that
    // hid the original problem for a week.
    return NextResponse.json({ ok: failed === 0, failed, checks }, { status: failed === 0 ? 200 : 500 });
  } catch (err) {
    return handleApiError(err);
  }
}
