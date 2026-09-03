import { NextResponse } from 'next/server';
import { WAIVER_TEXT } from '../../../lib/waiver';

/**
 * Single source of truth for the waiver text a signup form displays,
 * so the frontend never has to hardcode a second copy that could drift
 * from what the backend actually enforces/records.
 */
export async function GET() {
  return NextResponse.json({ text: WAIVER_TEXT });
}
