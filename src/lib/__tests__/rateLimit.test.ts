import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Stand-in for the Upstash client, with real INCR / EXPIRE / TTL semantics. */
class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number }>();
  now = 0;

  private live(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async incr(key: string) {
    const next = Number(this.live(key)?.value ?? 0) + 1;
    // A fresh INCR creates the key with no expiry, exactly like Redis.
    this.store.set(key, { value: String(next), expiresAt: this.live(key)?.expiresAt ?? Infinity });
    return next;
  }

  async expire(key: string, seconds: number) {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = this.now + seconds * 1000;
  }

  async ttl(key: string) {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === Infinity) return -1;
    return Math.ceil((entry.expiresAt - this.now) / 1000);
  }
}

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

beforeEach(() => {
  vi.resetModules();
  fake.store.clear();
  fake.now = 0;
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
  if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
});

describe('checkRateLimit', () => {
  it('allows up to the limit and refuses the next one', async () => {
    const { checkRateLimit } = await import('../rateLimit');
    for (let i = 0; i < 3; i++) {
      await expect(checkRateLimit('feedback:jane@example.com', 3, 60)).resolves.toBe(true);
    }
    await expect(checkRateLimit('feedback:jane@example.com', 3, 60)).resolves.toBe(false);
  });

  it('counts each caller separately', async () => {
    const { checkRateLimit } = await import('../rateLimit');
    await checkRateLimit('feedback:jane@example.com', 1, 60);
    await expect(checkRateLimit('feedback:jane@example.com', 1, 60)).resolves.toBe(false);
    await expect(checkRateLimit('feedback:bob@example.com', 1, 60)).resolves.toBe(true);
  });

  it('lets the caller back in once the window has passed', async () => {
    const { checkRateLimit } = await import('../rateLimit');
    await checkRateLimit('feedback:jane@example.com', 1, 60);
    await expect(checkRateLimit('feedback:jane@example.com', 1, 60)).resolves.toBe(false);

    fake.now += 61_000;
    await expect(checkRateLimit('feedback:jane@example.com', 1, 60)).resolves.toBe(true);
  });

  it('sets an expiry on the counter, rather than leaving it to accumulate forever', async () => {
    const { checkRateLimit } = await import('../rateLimit');
    await checkRateLimit('feedback:jane@example.com', 3, 60);
    await expect(fake.ttl('weekly-softball-scrimmage:ratelimit:feedback:jane@example.com')).resolves.toBe(60);
  });

  it('repairs a counter left without a TTL by a crash mid-call', async () => {
    const { checkRateLimit } = await import('../rateLimit');
    const key = 'weekly-softball-scrimmage:ratelimit:feedback:jane@example.com';
    // What an INCR that never reached its EXPIRE leaves behind. Without the
    // repair this key never expires and locks the person out permanently.
    fake.store.set(key, { value: '1', expiresAt: Infinity });

    await expect(checkRateLimit('feedback:jane@example.com', 3, 60)).resolves.toBe(true);
    await expect(fake.ttl(key)).resolves.toBe(60);
  });

  it('fails open when Redis is not configured, so local dev keeps working', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { checkRateLimit } = await import('../rateLimit');
    for (let i = 0; i < 10; i++) {
      await expect(checkRateLimit('feedback:jane@example.com', 1, 60)).resolves.toBe(true);
    }
    expect(fake.store.size).toBe(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
