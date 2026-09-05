import { NextResponse } from 'next/server';
import { requireCronSecret } from '../../../../lib/cronAuth';
import { sendGameDayReminders } from '../../../../lib/scheduling';
import { handleApiError } from '../../../../lib/apiErrors';

export async function POST(request: Request) {
  try {
    requireCronSecret(request);
    const result = await sendGameDayReminders();
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
