import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireCronSecret } from '../cronAuth';

const ORIGINAL = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = 'correct-horse-battery-staple';
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

function requestWithSecret(secret?: string): Request {
  return new Request('http://x', { headers: secret === undefined ? {} : { 'x-cron-secret': secret } });
}

describe('requireCronSecret', () => {
  it('accepts the exact secret', () => {
    expect(() => requireCronSecret(requestWithSecret('correct-horse-battery-staple'))).not.toThrow();
  });

  it('rejects a wrong secret of the same length', () => {
    expect(() => requireCronSecret(requestWithSecret('correct-horse-battery-stapleX'.slice(0, 29)))).toThrow(/Invalid or missing/);
  });

  it('rejects a missing header', () => {
    expect(() => requireCronSecret(requestWithSecret())).toThrow(/Invalid or missing/);
  });

  it('rejects an empty header', () => {
    expect(() => requireCronSecret(requestWithSecret(''))).toThrow(/Invalid or missing/);
  });

  it('rejects a correct prefix that is too short (the length-mismatch path)', () => {
    // timingSafeEqual throws on differing lengths, so this must be handled by
    // the explicit length check rather than blowing up as a 500.
    expect(() => requireCronSecret(requestWithSecret('correct-horse'))).toThrow(/Invalid or missing/);
  });

  it('rejects a longer string that starts with the secret', () => {
    expect(() => requireCronSecret(requestWithSecret('correct-horse-battery-staple-extra'))).toThrow(/Invalid or missing/);
  });

  it('fails closed with a 500 when the server has no secret configured', () => {
    delete process.env.CRON_SECRET;
    // Must not be treated as "no secret required" — an unset secret is a
    // server misconfiguration, not an open door.
    expect(() => requireCronSecret(requestWithSecret('anything'))).toThrow(/not configured/);
  });

  it('assigns the right status codes', () => {
    delete process.env.CRON_SECRET;
    expect(() => requireCronSecret(requestWithSecret('x'))).toThrow(expect.objectContaining({ status: 500 }));

    process.env.CRON_SECRET = 'secret';
    expect(() => requireCronSecret(requestWithSecret('nope'))).toThrow(expect.objectContaining({ status: 401 }));
  });
});
