const NTFY_PUBLISH_URL = 'https://ntfy.sh/';

/**
 * Low-level, content-agnostic push via ntfy.sh's JSON publish endpoint —
 * mirrors gmail.ts's split from notifications.ts (mechanics here, actual
 * message content lives with the rest of the app's notification text).
 * The topic name is the whole security model on ntfy's public server
 * (unguessable string = private channel), so it's a secret, not a
 * hardcoded constant.
 */
export async function sendPush(title: string, message: string): Promise<void> {
  const topic = process.env.ORGANIZER_ALERT_NTFY_TOPIC;
  if (!topic) {
    throw new Error(
      'Missing ORGANIZER_ALERT_NTFY_TOPIC — see Step 9 setup notes for generating and subscribing to a topic.'
    );
  }

  const res = await fetch(NTFY_PUBLISH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      title,
      message,
      priority: 5, // urgent — time-sensitive, last-minute alert
      tags: ['rotating_light'],
    }),
  });

  if (!res.ok) {
    throw new Error(`ntfy.sh push failed: ${res.status} ${res.statusText}`);
  }
}
