import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, handleApiError } from '../apiErrors';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function reply(err: unknown) {
  const res = handleApiError(err);
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
}

describe('handleApiError', () => {
  it('passes an ApiError through as it was written', async () => {
    expect(await reply(new ApiError(409, 'Signups for Friday, July 10 closed.'))).toEqual({
      status: 409,
      error: 'Signups for Friday, July 10 closed.',
    });
  });

  // The quota is the failure to expect during the Monday rush, and it passes.
  // "Internal server error" gave no hint that waiting would fix it.
  it('tells the player to wait out the Sheets quota', async () => {
    const quota = { status: 403, errors: [{ reason: 'rateLimitExceeded' }] };
    expect(await reply(quota)).toEqual({ status: 503, error: 'The app is busy. Try again in a minute.' });
  });

  // A write can land before a later step fails, so "error" may not mean
  // "nothing happened". Retrying blind then said "already signed up".
  it('tells the player to check whether it went through', async () => {
    expect(await reply(new Error('boom'))).toEqual({
      status: 500,
      error: 'Something went wrong. Refresh the page to see whether it went through.',
    });
    expect(console.error).toHaveBeenCalled();
  });
});
