import { NextResponse } from 'next/server';
import { requireCronSecret } from '../../../../lib/cronAuth';
import { closeRegistrationForCurrentSession } from '../../../../lib/scheduling';
import { handleApiError } from '../../../../lib/apiErrors';

export async function POST(request: Request) {
  try {
    requireCronSecret(request);
    const result = await closeRegistrationForCurrentSession();
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
