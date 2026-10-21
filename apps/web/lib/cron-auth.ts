import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

//---------------
// cron-auth — the shared gate of the pg_cron-triggered routes
// (/api/cron/*). The caller sends `Authorization: Bearer <CRON_SECRET>`;
// the shared secret is the only gate (no session, no rate limit).
//---------------

function secretsEqual(provided: string, expected: string): boolean {
  // Hash both sides first so timingSafeEqual never leaks the expected
  // length and never throws on length mismatch.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

//---------------
// rejectUnauthorizedCron — null when the request carries the cron secret;
// otherwise the response to return: 500 when CRON_SECRET is not configured
// (fail closed, logged), 401 when the bearer is missing or wrong.
//---------------
export function rejectUnauthorizedCron(
  request: Request,
  logTag: string,
  notConfiguredMessage: string,
): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error(`[${logTag}] CRON_SECRET is not configured; refusing to run`, null, {});
    return NextResponse.json({ success: false, error: notConfiguredMessage }, { status: 500 });
  }
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !secretsEqual(provided, cronSecret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }
  return null;
}
