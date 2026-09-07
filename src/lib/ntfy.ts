const NTFY_PUBLISH_URL = 'https://ntfy.sh/';

/**
 * Low-level, content-agnostic push via ntfy.sh's JSON publish endpoint —
 * mirrors gmail.ts's split from notifications.ts (mechanics here, actual
 * message content lives with the rest of the app's notification text).
 * The topic name is the whole security model on ntfy's public server
 * (unguessable string = private channel), so it's a secret, not a
 * hardcoded constant.
 */
export interface PushOptions {
  /** ntfy's 1-5 scale. 5 bypasses Do Not Disturb, so it's reserved for
   * genuinely time-critical alerts; 3 is the ordinary default. */
  priority?: number;
  /** ntfy tag names, which render as the notification's emoji. */
  tags?: string[];
  /** URL opened when the notification itself is tapped. */
  click?: string;
}

export async function sendPush(title: string, message: string, options: PushOptions = {}): Promise<void> {
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
      // Defaults suit the original caller (the late-cancellation alert):
      // urgent, because it's time-sensitive and the organizer has minutes
      // to act. Anything less pressing passes its own priority.
      priority: options.priority ?? 5,
      tags: options.tags ?? ['rotating_light'],
      // ntfy ignores the field when it's undefined, so an alert with
      // nowhere useful to point simply doesn't get a tap action.
      click: options.click,
    }),
  });

  if (!res.ok) {
    throw new Error(`ntfy.sh push failed: ${res.status} ${res.statusText}`);
  }
}
