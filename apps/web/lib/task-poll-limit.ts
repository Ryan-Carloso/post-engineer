import 'server-only';

import type { NextResponse } from 'next/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export interface TaskPollCaller {
  userId: string;
  isApiKey?: boolean;
  isOAuth?: boolean;
  keyId?: string;
}

export function machinePollerId(auth: TaskPollCaller): string | null {
  if (auth.isApiKey === true && auth.keyId !== undefined) return `api-key:${auth.keyId}`;
  if (auth.isApiKey === true) return `api-key-user:${auth.userId}`;
  if (auth.isOAuth === true) return `oauth:${auth.userId}`;
  return null;
}

export async function applyTaskPollLimit(
  request: Request,
  auth: TaskPollCaller,
  taskId: string,
): Promise<NextResponse | null> {
  const caller = machinePollerId(auth);
  if (caller === null) return null;
  return applyRateLimit(request, RATE_LIMITS.taskStatusPoll, `${caller}:${taskId}`);
}
