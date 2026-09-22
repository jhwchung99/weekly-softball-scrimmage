import { describe, it, expect, vi, beforeEach } from 'vitest';

const listSessions = vi.fn();
vi.mock('../../../../../sheets/sessions', () => ({ listSessions }));

const { GET } = await import('../route');
// Imported after the mocks, not at the top: this module imports sheets/sessions,
// and pulling it in early evaluates the mock factory before its vi.fn exists.
const { forgetCurrentWeek } = await import('../../../../../lib/currentWeek');

/** Far enough out to still be upcoming whenever this suite runs. */
const FRIDAY = { sessionId: '2099-01-02', gameDate: '2099-01-02', gameTime: '18:00', status: 'open' };
const SUNDAY = { sessionId: '2099-01-04', gameDate: '2099-01-04', gameTime: '14:00', status: 'open' };

beforeEach(() => {
  // This route reads through a cache; each case starts cold.
  forgetCurrentWeek();
  vi.clearAllMocks();
});

describe('GET /api/sessions/current', () => {
  it('returns an empty list when nothing is scheduled', async () => {
    listSessions.mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).sessions).toEqual([]);
    // One whole-tab read, not one lookup per day.
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('returns a lone session, which is what most weeks are', async () => {
    listSessions.mockResolvedValue([FRIDAY]);

    const body = await (await GET()).json();

    expect(body.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['2099-01-02']);
  });

  it('returns every upcoming session, soonest first', async () => {
    // The bug this replaced: the lookup took the first of
    // Friday/Saturday/Sunday that had a row, so a Sunday game created beside a
    // Friday one was invisible here and everywhere downstream of it.
    listSessions.mockResolvedValue([SUNDAY, FRIDAY]);

    const body = await (await GET()).json();

    expect(body.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['2099-01-02', '2099-01-04']);
  });

  it('sends only the published schedule, never the organizer’s bookkeeping', async () => {
    listSessions.mockResolvedValue([{ ...FRIDAY, cost: 240 }]);

    const body = await (await GET()).json();

    expect(body.sessions[0]).not.toHaveProperty('cost');
  });
});
