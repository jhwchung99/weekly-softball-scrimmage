import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordFeedback } from '../feedback';
import { sendPush } from '../ntfy';
import { appendFeedback } from '../../sheets/feedback';

vi.mock('../ntfy', () => ({ sendPush: vi.fn(async () => {}) }));
vi.mock('../../sheets/feedback', () => ({ appendFeedback: vi.fn(async () => {}) }));

const pushed = vi.mocked(sendPush);
const appended = vi.mocked(appendFeedback);

const REPORT = {
  kind: 'bug' as const,
  message: 'The cancel button does nothing.',
  pageUrl: '/guidelines',
  fromEmail: 'jane@example.com',
  fromName: 'Jane Doe',
};

function lastPush() {
  const [title, message, options] = pushed.mock.calls.at(-1)!;
  return { title, message, options };
}

function lastRow() {
  return appended.mock.calls.at(-1)![0];
}

beforeEach(() => {
  pushed.mockClear();
  pushed.mockResolvedValue(undefined);
  appended.mockClear();
  appended.mockResolvedValue(undefined);
});

describe('recordFeedback: the Feedback row', () => {
  it('records the message, reporter, page, and kind', async () => {
    await recordFeedback(REPORT);
    expect(lastRow()).toMatchObject({
      kind: 'bug',
      message: 'The cancel button does nothing.',
      email: 'jane@example.com',
      fullName: 'Jane Doe',
      pageUrl: '/guidelines',
    });
  });

  it('stamps the time it was submitted', async () => {
    await recordFeedback(REPORT, new Date('2026-09-07T14:30:00.000Z'));
    expect(lastRow().submittedAt).toBe('2026-09-07T14:30:00.000Z');
  });

  it('gives every report its own id', async () => {
    await recordFeedback(REPORT);
    await recordFeedback(REPORT);
    const [first, second] = appended.mock.calls.map((c) => c[0].feedbackId);
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('flattens a multi-line account name', async () => {
    await recordFeedback({ ...REPORT, fromName: 'Jane\nDoe' });
    expect(lastRow().fullName).toBe('Jane Doe');
  });

  it('fails the request when the row cannot be written, rather than silently losing it', async () => {
    appended.mockRejectedValue(new Error('Sheets is down'));
    await expect(recordFeedback(REPORT)).rejects.toThrow('Sheets is down');
    expect(pushed).not.toHaveBeenCalled();
  });
});

describe('recordFeedback: the push alert', () => {
  it('says a bug report arrived, without repeating the message', async () => {
    await recordFeedback(REPORT);
    const { title, message } = lastPush();
    expect(title).toBe('Bug report submitted');
    expect(message).toContain('Jane Doe');
    expect(message).toContain('Feedback tab');
    // The whole point of the sheet is that the alert stays short.
    expect(message).not.toContain('The cancel button does nothing.');
  });

  it('distinguishes a suggestion from a bug by title and emoji', async () => {
    await recordFeedback({ ...REPORT, kind: 'feedback' });
    const { title, options } = lastPush();
    expect(title).toBe('Feedback submitted');
    expect(options?.tags).toEqual(['speech_balloon']);
  });

  it('sends at normal priority, not the late-cancellation alert priority', async () => {
    // 5 bypasses Do Not Disturb and is reserved for "you have minutes to
    // fill this spot". A bug report at 2am should not wake anyone.
    await recordFeedback(REPORT);
    expect(lastPush().options?.priority).toBe(3);
  });

  it('links to the spreadsheet so the alert can be tapped through to the message', async () => {
    const previous = process.env.SPREADSHEET_ID;
    process.env.SPREADSHEET_ID = 'sheet-123';
    vi.resetModules();
    const { recordFeedback: fresh } = await import('../feedback');

    await fresh(REPORT);
    expect(lastPush().options?.click).toBe('https://docs.google.com/spreadsheets/d/sheet-123/edit');

    if (previous === undefined) delete process.env.SPREADSHEET_ID;
    else process.env.SPREADSHEET_ID = previous;
  });

  it('names the reporter by email when Google supplied no display name', async () => {
    await recordFeedback({ ...REPORT, fromName: '' });
    expect(lastPush().message).toContain('jane@example.com');
  });

  it('keeps the feedback even when the push fails, since the row is the record', async () => {
    pushed.mockRejectedValue(new Error('ntfy is down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(recordFeedback(REPORT)).resolves.toBeUndefined();
    expect(appended).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});
