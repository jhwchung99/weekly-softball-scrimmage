import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 0% covered, and it is the module that decides what leaves the building.
 *
 * The header-injection guard is the reason this matters more than coverage
 * arithmetic: `to` and `subject` are interpolated straight into RFC822 header
 * lines, so a CR/LF in either would let a caller append headers of their own —
 * a Bcc, a different Subject, a second message. No current caller passes raw
 * user text, and the guard exists so that staying true is not a matter of
 * everyone remembering.
 */

type SendArgs = { userId: string; requestBody: { raw: string } };
const send = vi.fn<(args: SendArgs) => Promise<object>>(async () => ({}));
const setCredentials = vi.fn();

vi.mock('googleapis', () => ({
  google: { gmail: () => ({ users: { messages: { send } } }) },
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials = setCredentials;
  },
}));

const { sendEmail } = await import('../gmail');

/** The RFC822 message the last send actually carried. */
function lastMessage(): string {
  const raw = send.mock.calls.at(-1)![0].requestBody.raw;
  return Buffer.from(raw, 'base64url').toString('utf8');
}

const ENV = {
  GMAIL_SENDER_EMAIL: 'organizer@dummy.test',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GMAIL_SENDER_REFRESH_TOKEN: 'token',
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, ENV);
});

afterEach(() => {
  for (const key of Object.keys(ENV)) delete process.env[key as keyof typeof ENV];
});

describe('sendEmail', () => {
  it('builds a plain-text message from the configured sender', async () => {
    await sendEmail('kevin@dummy.test', 'You are in', 'See you Friday.');

    expect(lastMessage()).toBe(
      [
        'To: kevin@dummy.test',
        'From: organizer@dummy.test',
        'Subject: You are in',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'See you Friday.',
      ].join('\r\n')
    );
  });

  it('sends as the authenticated user', async () => {
    await sendEmail('kevin@dummy.test', 's', 't');
    expect(send.mock.calls.at(-1)![0].userId).toBe('me');
  });

  it('survives a body with newlines, accents and non-ASCII', async () => {
    // The body is content, not a header, so it is unaffected by the guard —
    // and it has to round-trip through base64url intact.
    const text = 'Line one\nLine two — café ⚾';
    await sendEmail('kevin@dummy.test', 's', text);

    expect(lastMessage().endsWith(text)).toBe(true);
  });

  it('refuses a recipient carrying a CR/LF, rather than sending extra headers', async () => {
    await expect(sendEmail('kevin@dummy.test\r\nBcc: everyone@dummy.test', 's', 't')).rejects.toThrow(/to contains a CR\/LF/);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a subject carrying a CR/LF for the same reason', async () => {
    await expect(sendEmail('kevin@dummy.test', 'Hi\nBcc: everyone@dummy.test', 't')).rejects.toThrow(
      /subject contains a CR\/LF/
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('catches a bare carriage return, not just a newline', async () => {
    await expect(sendEmail('kevin@dummy.test\rX: y', 's', 't')).rejects.toThrow(/CR\/LF/);
  });

  it('says what is missing when the sender address is not configured', async () => {
    delete process.env.GMAIL_SENDER_EMAIL;
    await expect(sendEmail('kevin@dummy.test', 's', 't')).rejects.toThrow(/GMAIL_SENDER_EMAIL/);
  });

  it('names the setup command when the OAuth credentials are missing', async () => {
    // The recovery is a specific script, and an error that does not name it
    // leaves whoever hits it guessing.
    vi.resetModules();
    delete process.env.GMAIL_SENDER_REFRESH_TOKEN;
    const fresh = await import('../gmail');

    await expect(fresh.sendEmail('kevin@dummy.test', 's', 't')).rejects.toThrow(/authorize-gmail-sender/);
  });
});
