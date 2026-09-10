import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendPush } from '../ntfy';

/**
 * The organizer's phone is the only channel that reaches them in minutes, and
 * this module was 14% covered. What it gets wrong is silent by construction:
 * every caller wraps it in `deliver`, which swallows the failure.
 */

const fetchMock = vi.fn();
const TOPIC = 'a-very-unguessable-topic';

/** The JSON the last push sent. */
function lastBody() {
  return JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
  vi.stubGlobal('fetch', fetchMock);
  process.env.ORGANIZER_ALERT_NTFY_TOPIC = TOPIC;
});

afterEach(() => {
  delete process.env.ORGANIZER_ALERT_NTFY_TOPIC;
});

describe('sendPush', () => {
  it('publishes to the configured topic', async () => {
    // The topic name is the whole security model on ntfy's public server, so
    // it comes from the environment and never from a constant here.
    await sendPush('Late cancellation', 'Kevin dropped out');

    expect(fetchMock).toHaveBeenCalledWith('https://ntfy.sh/', expect.objectContaining({ method: 'POST' }));
    expect(lastBody()).toMatchObject({ topic: TOPIC, title: 'Late cancellation', message: 'Kevin dropped out' });
  });

  it('defaults to the priority that gets through Do Not Disturb', async () => {
    // The original caller is the late-cancellation alert: time-critical, and
    // the organizer has minutes to act.
    await sendPush('t', 'm');

    expect(lastBody()).toMatchObject({ priority: 5, tags: ['rotating_light'] });
  });

  it('lets a less pressing alert ask for less', async () => {
    await sendPush('t', 'm', { priority: 3, tags: ['softball'] });

    expect(lastBody()).toMatchObject({ priority: 3, tags: ['softball'] });
  });

  it('keeps priority 0 rather than treating it as unset', async () => {
    // `??` not `||`: the difference only shows at the falsy end of the scale.
    await sendPush('t', 'm', { priority: 0 });

    expect(lastBody().priority).toBe(0);
  });

  it('carries a tap target when there is somewhere useful to go', async () => {
    await sendPush('t', 'm', { click: 'https://example.test/admin' });

    expect(lastBody().click).toBe('https://example.test/admin');
  });

  it('sends no tap target rather than a broken one', async () => {
    await sendPush('t', 'm');

    expect(lastBody()).not.toHaveProperty('click');
  });

  it('refuses to send with no topic configured, and says how to fix it', async () => {
    // Silently doing nothing would mean the organizer never learns the alerts
    // are not arriving.
    delete process.env.ORGANIZER_ALERT_NTFY_TOPIC;

    await expect(sendPush('t', 'm')).rejects.toThrow(/ORGANIZER_ALERT_NTFY_TOPIC/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with the status when ntfy rejects the push', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });

    await expect(sendPush('t', 'm')).rejects.toThrow(/429 Too Many Requests/);
  });
});
