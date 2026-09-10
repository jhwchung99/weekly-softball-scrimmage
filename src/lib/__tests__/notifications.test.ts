import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The module that decides what every email and push actually says had no test
 * file. Tests that cared about notifications reached past it to the two
 * transports underneath, so what they asserted was that *something* was sent,
 * never what it said.
 *
 * Two things are pinned here. First `deliver`, which is the guarantee that a
 * failed send cannot fail the action that triggered it — previously
 * re-promised by hand at thirteen call sites with nothing testing it was
 * there. Then the wording of each message, at the level a player would notice
 * if it regressed: who it is addressed to, what it tells them, and the figures
 * in it.
 */

const sendEmail = vi.fn(async () => {});
const sendPush = vi.fn(async () => {});
vi.mock('../gmail', () => ({ sendEmail }));
vi.mock('../ntfy', () => ({ sendPush }));

const notifications = await import('../notifications');

const SESSION = {
  sessionId: '2026-07-10',
  gameDate: '2026-07-10',
  gameTime: '18:00',
  registrationOpensAt: '',
  registrationClosesAt: '',
  capacity: 12,
  status: 'open' as const,
  cost: 0,
  pricePerSpot: 10,
  locationArea: 'Mississauga',
  locationName: 'Iceland Park Diamond 3',
  locationUrl: '',
  numFields: 1,
  teamsStatus: '' as const,
};

const PLAYER = {
  signupId: 's1',
  sessionId: '2026-07-10',
  email: 'kevin@dummy.test',
  fullName: 'Kevin Kim',
  gender: 'Male',
  memberStatus: 'member' as const,
  invitedByName: '',
  willingToShare: false,
  pairId: '',
  status: 'confirmed' as const,
  timestamp: '2026-07-06T13:00:00.000Z',
  positions: 'Catcher',
  waiverAcceptedAt: '2026-07-06T13:00:00.000Z',
  waiverText: 'waiver',
  paid: false,
  amountPaid: 0,
  paidAt: '',
  attended: false,
  subRequestTargetEmail: '',
  subRequestStatus: '' as const,
  subRequestedAt: '',
  teamName: '',
};

/** The single email this send produced, as { to, subject, text }. */
function lastEmail() {
  const [to, subject, text] = sendEmail.mock.calls.at(-1) as unknown as [string, string, string];
  return { to, subject, text };
}

function lastPush() {
  const [title, message] = sendPush.mock.calls.at(-1) as unknown as [string, string];
  return { title, message };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deliver — a failed notification never fails the action that triggered it', () => {
  it('swallows a transport failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      notifications.deliver('a test message', async () => {
        throw new Error('gmail is down');
      })
    ).resolves.toBe(false);

    error.mockRestore();
  });

  it('still records the failure where someone can find it', async () => {
    // Swallowing is the guarantee; staying silent about it is not. Silent
    // failure is what the production self-test endpoint exists to catch.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await notifications.deliver('the promotion email', async () => {
      throw new Error('gmail is down');
    });

    expect(error).toHaveBeenCalledWith(expect.stringContaining('the promotion email'), expect.any(Error));
    error.mockRestore();
  });

  it('reports success, so a caller sending to a list can keep a tally', async () => {
    await expect(notifications.deliver('a test message', async () => {})).resolves.toBe(true);
  });

  it('runs the send exactly once', async () => {
    const send = vi.fn(async () => {});

    await notifications.deliver('a test message', send);

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('what the messages say', () => {
  it('tells a promoted player they are in, and where to turn up', async () => {
    await notifications.sendPromotionEmail(PLAYER, SESSION);

    const { to, subject, text } = lastEmail();
    expect(to).toBe('kevin@dummy.test');
    expect(subject).toMatch(/You're in/);
    expect(text).toMatch(/Hi Kevin Kim/);
    expect(text).toMatch(/moved up from the waitlist/);
    expect(text).toMatch(/Iceland Park Diamond 3/);
  });

  it('tells the organizer who dropped late and that nobody was auto-promoted', async () => {
    await notifications.sendLateCancellationAlert(PLAYER, SESSION);

    const { title, message } = lastPush();
    expect(title).toMatch(/Late cancellation/);
    expect(message).toMatch(/Kevin Kim \(Catcher\)/);
    expect(message).toMatch(/No one was auto-promoted/);
  });

  it('tells the organizer who owes what when a late cancellation is unpaid', async () => {
    // Saves them wondering whether to chase or refund.
    await notifications.sendLateCancellationAlert(PLAYER, SESSION, 10);

    expect(lastPush().message).toMatch(/still owe \$10\.00/);
  });

  it('says not to chase a late cancellation that was already paid', async () => {
    await notifications.sendLateCancellationAlert({ ...PLAYER, paid: true, amountPaid: 10 }, SESSION, 10);

    const { message } = lastPush();
    expect(message).toMatch(/already paid \$10\.00/);
    expect(message).toMatch(/No refund/);
  });

  it('tells the organizer how many spots are still open after registration closes', async () => {
    await notifications.sendOpenSpotsAlert(SESSION, 3);

    expect(lastPush().message).toMatch(/3/);
  });

  it('tells the organizer the headcount when registration closes', async () => {
    await notifications.sendHeadcountAlert(SESSION, 11, 2);

    const { message } = lastPush();
    expect(message).toMatch(/11/);
    expect(message).toMatch(/2/);
  });

  it('names the requester when someone asks to share a spot', async () => {
    const asker = { ...PLAYER, signupId: 's2', email: 'asker@dummy.test', fullName: 'Asker Ann', status: 'waitlisted' as const };

    await notifications.sendSubRequestEmail(PLAYER, asker, SESSION);

    const { to, text } = lastEmail();
    expect(to).toBe('kevin@dummy.test');
    expect(text).toMatch(/Asker Ann/);
  });

  it('tells a member a guest named them, so they know what they are agreeing to', async () => {
    const guest = { ...PLAYER, signupId: 's3', email: 'guest@dummy.test', fullName: 'Guest Gil', memberStatus: 'guest' as const, invitedByName: 'Kevin Kim' };

    await notifications.sendGuestPairRequestEmail(PLAYER, guest, SESSION);

    const { to, text } = lastEmail();
    expect(to).toBe('kevin@dummy.test');
    expect(text).toMatch(/Guest Gil/);
  });

  it('tells the organizer teams are ready, with each team’s shortfall', async () => {
    await notifications.sendTeamsReadyAlert(SESSION, [
      { name: 'Team 1', members: [], deficiency: 1, missing: ['Catcher'] },
      { name: 'Team 2', members: [], deficiency: 0, missing: [] },
    ]);

    const { title, message } = lastPush();
    expect(title).toMatch(/Teams ready/);
    expect(message).toMatch(/Catcher/);
  });

  it('addresses a session update to the player and carries the organizer’s note', async () => {
    await notifications.sendSessionUpdateEmail(PLAYER, SESSION, 'Field moved to Diamond 5.');

    const { to, text } = lastEmail();
    expect(to).toBe('kevin@dummy.test');
    expect(text).toMatch(/Field moved to Diamond 5\./);
  });

  it('says the session is cancelled, and carries the reason', async () => {
    await notifications.sendSessionCancelledEmail(PLAYER, SESSION, 'Rained out.');

    const { subject, text } = lastEmail();
    expect(subject).toMatch(/cancel/i);
    expect(text).toMatch(/Rained out\./);
  });

  it('asks for the amount owed once payment has opened', async () => {
    // After the roster lock, so the nudge asks rather than saying "not yet".
    await notifications.sendPaymentNudgeEmail(PLAYER, SESSION, 10, new Date('2026-07-10T20:00:00.000Z'));

    const { to, text } = lastEmail();
    expect(to).toBe('kevin@dummy.test');
    expect(text).toMatch(/\$10\.00/);
    expect(text).toMatch(/before the game/i);
  });

  it('tells a player payment is not open yet when the roster has not locked', async () => {
    await notifications.sendPaymentNudgeEmail(PLAYER, SESSION, 10, new Date('2026-07-09T12:00:00.000Z'));

    expect(lastEmail().text).toMatch(/Payment opens/);
  });
});
