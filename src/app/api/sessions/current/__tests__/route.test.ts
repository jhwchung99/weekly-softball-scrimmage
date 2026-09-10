import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionByAnyId = vi.fn();
vi.mock('../../../../../sheets/sessions', () => ({ getSessionByAnyId }));

const { GET } = await import('../route');
// Imported after the mocks, not at the top: this module imports sheets/sessions,
// and pulling it in early evaluates the mock factory before its vi.fn exists.
const { forgetCurrentWeek } = await import('../../../../../lib/currentWeek');

beforeEach(() => {
  // This route reads the week through a cache; each case starts cold.
  forgetCurrentWeek();
  vi.clearAllMocks();
});

describe('GET /api/sessions/current', () => {
  it('returns null when no session exists under any Friday/Saturday/Sunday candidate', async () => {
    getSessionByAnyId.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBeNull();
    // Checks all three candidates in one call, not one lookup per day.
    expect(getSessionByAnyId).toHaveBeenCalledTimes(1);
    expect(getSessionByAnyId).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String), expect.any(String), expect.any(String)]));
  });

  it('returns whichever session getSessionByAnyId finds (e.g. a Saturday game)', async () => {
    getSessionByAnyId.mockResolvedValue({ sessionId: '2026-07-11', gameDate: '2026-07-11', gameTime: '10:00', status: 'open' });

    const res = await GET();

    const body = await res.json();
    expect(body.session.sessionId).toBe('2026-07-11');
  });
});
