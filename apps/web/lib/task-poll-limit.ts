import 'server-only';

import type { NextResponse } from 'next/server';
import { applyRateLimit, type RateLimitProfile } from '@/lib/rate-limit';

export type TaskPollCaller =
  | { userId: string; isApiKey: true; keyId: string; isOAuth?: false }
  | { userId: string; isApiKey?: false; isOAuth: true; keyId?: string }
  | { userId: string; isApiKey?: false; isOAuth?: false; keyId?: string };

export interface TaskPollAuth {
  userId: string;
  isApiKey?: boolean;
  isOAuth?: boolean;
  keyId?: string;
}

export function taskPollCaller(auth: TaskPollAuth): TaskPollCaller {
  if (auth.isApiKey === true) {
    if (auth.keyId === undefined) {
      throw new Error('API-key caller without a key id cannot be rate limited per key');
    }
    return { userId: auth.userId, isApiKey: true, keyId: auth.keyId };
  }
  if (auth.isOAuth === true) return { userId: auth.userId, isOAuth: true };
  return { userId: auth.userId };
}

export function machinePollerId(auth: TaskPollCaller): string | null {
  if (auth.isApiKey === true) return `api-key:${auth.keyId}`;
  if (auth.isOAuth === true) return `oauth:${auth.userId}`;
  return null;
}

export async function applyTaskPollLimit(
  request: Request,
  auth: TaskPollCaller,
  taskId: string,
  profile: RateLimitProfile,
): Promise<NextResponse | null> {
  const caller = machinePollerId(auth);
  if (caller === null) return null;
  return applyRateLimit(request, profile, `${caller}:${taskId}`);
}
