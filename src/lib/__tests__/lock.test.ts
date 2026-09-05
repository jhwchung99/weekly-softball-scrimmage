import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A minimal stand-in for the Upstash Redis client, implementing just the three
 * operations the lock uses, with real SET NX / TTL semantics.
 */
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

  async set(key: string, value: string, opts: { nx?: boolean; ex?: number }) {
    if (opts.nx && this.live(key)) return null;
    this.store.set(key, { value, expiresAt: this.now + (opts.ex ?? 0) * 1000 });
    return 'OK';
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.live(key)?.value ?? null) as T | null;
  }

  async del(key: string) {
    this.store.delete(key);
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

describe('withMutationLock', () => {
  it('runs the work and returns its result', async () => {
    const { withMutationLock } = await import('../lock');
    await expect(withMutationLock(async () => 'done')).resolves.toBe('done');
  });

  it('releases the lock afterwards, so a second call can acquire it', async () => {
    const { withMutationLock } = await import('../lock');
    await withMutationLock(async () => 'first');
    expect(fake.store.size).toBe(0);
    await expect(withMutationLock(async () => 'second')).resolves.toBe('second');
  });

  it('releases the lock even when the work throws', async () => {
    const { withMutationLock } = await import('../lock');
    await expect(withMutationLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(fake.store.size).toBe(0);
  });

  it('serializes overlapping callers rather than running them together', async () => {
    const { withMutationLock } = await import('../lock');
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((r) => (releaseFirst = r));

    const first = withMutationLock(async () => {
      order.push('first:start');
      await firstStarted;
      order.push('first:end');
    });
    // Give the first call a turn to actually take the lock.
    await Promise.resolve();
    const second = withMutationLock(async () => { order.push('second:start'); });

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not delete a lock that has already been reassigned to another holder', async () => {
    const { withMutationLock } = await import('../lock');

    await withMutationLock(async () => {
      // Simulate this holder's lock expiring and someone else taking it.
      fake.store.set('weekly-softball-scrimmage:mutation-lock', { value: 'someone-elses-token', expiresAt: Infinity });
    });

    // The other holder's lock must survive — releasing checks the token first.
    expect(fake.store.get('weekly-softball-scrimmage:mutation-lock')?.value).toBe('someone-elses-token');
  });

  it('sets a TTL long enough to outlast worst-case Sheets retry backoff', async () => {
    const { withMutationLock } = await import('../lock');
    let ttlSeconds = 0;
    const setSpy = vi.spyOn(fake, 'set').mockImplementation(async (key, value, opts) => {
      ttlSeconds = opts.ex ?? 0;
      fake.store.set(key, { value, expiresAt: fake.now + (opts.ex ?? 0) * 1000 });
      return 'OK';
    });

    await withMutationLock(async () => 'x');

    // cancelMySignup makes ~6 sequential Sheets calls, each able to sleep 7s
    // on rate-limit backoff. A TTL below that expires mid-operation and lets a
    // second request in alongside the first (review Bug 5).
    expect(ttlSeconds).toBeGreaterThanOrEqual(42);
    setSpy.mockRestore();
  });

  it('fails open (runs unlocked) when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { withMutationLock } = await import('../lock');
    await expect(withMutationLock(async () => 'ran anyway')).resolves.toBe('ran anyway');
    expect(fake.store.size).toBe(0); // never touched Redis
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
