import { HttpStatusError } from './errors';

export const MAX_QUERY_RETRIES = 1;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpStatusError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
