import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The route exists because a missing headcount push turned out to have four
 * independent causes, none of them visible from anywhere. The Redis check is
 * the fifth of that kind: the lock and the rate limiter both fail open, so an
 * unset Upstash variable produces no error, no alert and no failed request —
 * only a `console.warn` in a serverless log, and a week that can quietly
 * oversubscribe.
 */

const requireCronSecret = vi.fn();
vi.mock('../../../../../lib/cronAuth', () => ({ requireCronSecret }));

const getSessionByAnyId = vi.fn(async () => null);
vi.mock('../../../../../sheets/sessions', () => ({ getSessionByAnyId }));
vi.mock('../../../../../sheets/signups', () => ({ listSignupsForSession: vi.fn(async () => []) }));

const getRedis = vi.fn();
vi.mock('../../../../../lib/redis', () => ({ getRedis }));

const sendPush = vi.fn(async () => undefined);
vi.mock('../../../../../lib/ntfy', () => ({ sendPush }));
const sendEmail = vi.fn(async () => undefined);
vi.mock('../../../../../lib/gmail', () => ({ sendEmail }));

const { POST } = await import('../route');

/** A Redis that behaves, remembering what it was given. */
function workingRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => void store.delete(key)),
    store,
  };
}

async function run() {
  const res = await POST(new Request('http://x', { method: 'POST' }));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GMAIL_SENDER_EMAIL = 'organizer@dummy.test';
  getRedis.mockReturnValue(workingRedis());
});

describe('POST /api/cron/self-test — the redis check', () => {
  it('passes when the lock store round-trips a key', async () => {
    const { status, body } = await run();

    expect(body.checks.redis).toMatch(/^ok —/);
    expect(status).toBe(200);
  });

  it('fails loudly when Upstash is not configured, and names the variables', async () => {
    // The whole point: unconfigured is silent everywhere else in the app.
    getRedis.mockReturnValue(null);

    const { status, body } = await run();

    expect(body.checks.redis).toMatch(/FAILED/);
    expect(body.checks.redis).toMatch(/UPSTASH_REDIS_REST_URL/);
    expect(status).toBe(500);
  });

  it('fails when the credentials are set but wrong', async () => {
    // A bad URL or token fails in exactly the same invisible way as an absent
    // one, so presence is not what gets checked.
    const broken = workingRedis();
    broken.set.mockRejectedValue(new Error('WRONGPASS'));
    getRedis.mockReturnValue(broken);

    const { body } = await run();

    expect(body.checks.redis).toMatch(/FAILED — WRONGPASS/);
  });

  it('fails when the key does not read back as written', async () => {
    const lying = workingRedis();
    lying.get.mockResolvedValue('something else');
    getRedis.mockReturnValue(lying);

    const { body } = await run();

    expect(body.checks.redis).toMatch(/FAILED/);
  });

  it('never touches the real lock key, and cleans up after itself', async () => {
    // Writing the lock key here would be the self-test causing the outage it
    // is meant to detect.
    const redis = workingRedis();
    getRedis.mockReturnValue(redis);

    await run();

    const keys = redis.set.mock.calls.map((c) => c[0]);
    expect(keys).not.toContain('weekly-softball-scrimmage:mutation-lock');
    expect(redis.del).toHaveBeenCalledWith('weekly-softball-scrimmage:self-test');
    expect(redis.store.size).toBe(0);
  });

  it('expires its key, so a crash mid-check leaves nothing behind', async () => {
    const redis = workingRedis();
    getRedis.mockReturnValue(redis);

    await run();

    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), { ex: 30 });
  });

  it('still runs the other checks when redis fails', async () => {
    // The value of this route is learning which layers are broken in one run.
    getRedis.mockReturnValue(null);

    const { body } = await run();

    expect(body.checks.sheets).toMatch(/^ok —/);
    expect(sendPush).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalled();
    expect(body.failed).toBe(1);
  });
});
