import { NextResponse } from 'next/server';
import { isRateLimitError } from '../sheets/rateLimitError';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  // The quota outlasted the client's retries. Expected during the Monday rush,
  // and waiting is what fixes it.
  if (isRateLimitError(err)) {
    return NextResponse.json({ error: 'The app is busy. Try again in a minute.' }, { status: 503 });
  }
  // Not "Internal server error": flows write in steps, so an earlier write may
  // have landed before this failed, and retrying blind is how a player was told
  // "You're already signed up" with no idea why.
  return NextResponse.json({ error: 'Something went wrong. Refresh the page to see whether it went through.' }, { status: 500 });
}
