import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

let gmailClient: ReturnType<typeof google.gmail> | undefined;

function getGmailClient() {
  if (gmailClient) return gmailClient;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_SENDER_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_SENDER_REFRESH_TOKEN — ' +
        'run `npm run authorize-gmail-sender` and add the printed values to .env.local.'
    );
  }

  const auth = new OAuth2Client(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

/**
 * `to`/`subject` are interpolated directly into raw RFC822 header lines
 * below, so a CR/LF in either would let a caller inject arbitrary extra
 * headers or smuggle content — not exploitable today (every current
 * caller passes the OAuth-verified session email and a system-built
 * subject, never raw user text) but this guards against that becoming
 * true later. `text` is body content, not a header, so it's unaffected.
 */
function assertNoHeaderInjection(value: string, fieldName: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Refusing to send email: ${fieldName} contains a CR/LF character.`);
  }
}

function encodeMimeMessage(to: string, from: string, subject: string, text: string): string {
  assertNoHeaderInjection(to, 'to');
  assertNoHeaderInjection(subject, 'subject');
  const message = [`To: ${to}`, `From: ${from}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', text].join(
    '\r\n'
  );
  return Buffer.from(message).toString('base64url');
}

/**
 * Sends a plain-text email as GMAIL_SENDER_EMAIL. Low-level and
 * content-agnostic on purpose — notifications.ts owns what the app
 * actually says in any given email.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const from = process.env.GMAIL_SENDER_EMAIL;
  if (!from) throw new Error('Missing GMAIL_SENDER_EMAIL in the environment.');

  const gmail = getGmailClient();
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodeMimeMessage(to, from, subject, text) },
  });
}
