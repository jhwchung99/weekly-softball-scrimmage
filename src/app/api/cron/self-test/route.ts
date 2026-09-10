import { NextResponse } from 'next/server';
import { requireCronSecret } from '../../../../lib/cronAuth';
import { getSessionByAnyId } from '../../../../sheets/sessions';
import { listSignupsForSession } from '../../../../sheets/signups';
import { currentWeekGameDayCandidates } from '../../../../lib/time';
import { countConfirmedSpots } from '../../../../lib/payments';
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
 * ntfy, Gmail — and reports each independently, so a failure names the layer
 * rather than just going quiet.
 *
 * SAFETY, because this runs against production data:
 *   - Nothing is written. No session, signup, or player row is touched.
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
