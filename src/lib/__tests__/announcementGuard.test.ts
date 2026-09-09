import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkRateLimit = vi.fn();
vi.mock('../rateLimit', () => ({ checkRateLimit }));

const { guardAnnouncement } = await import('../announcementGuard');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guardAnnouncement', () => {
  it('lets the first send through', async () => {
    checkRateLimit.mockResolvedValue(true);
    await expect(guardAnnouncement('notify', '2099-01-01')).resolves.toBeUndefined();
  });

  it('rejects a second send inside the cooldown, so a reload cannot double-mail everyone', async () => {
    checkRateLimit.mockResolvedValue(false);
    await expect(guardAnnouncement('notify', '2099-01-01')).rejects.toMatchObject({
      status: 429,
      message: expect.stringMatching(/wait a minute/i),
    });
  });

  it('keys on the session and the kind, not the admin — two admins clicking still send one email each way', async () => {
    checkRateLimit.mockResolvedValue(true);
    await guardAnnouncement('notify', '2099-01-01');
    await guardAnnouncement('payment-reminders', '2099-01-01');

    expect(checkRateLimit).toHaveBeenNthCalledWith(1, 'announce:notify:2099-01-01', 1, 60);
    expect(checkRateLimit).toHaveBeenNthCalledWith(2, 'announce:payment-reminders:2099-01-01', 1, 60);
  });
});
