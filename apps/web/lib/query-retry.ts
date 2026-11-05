import { HttpStatusError } from './errors';

//---------------
// shouldRetryQuery — the dashboard's default React Query retry policy.
// A 4xx answer (expired session, bad input, missing row) is permanent:
// retrying it can never succeed, it only doubles failed traffic. Network
// errors, 5xx and anything without a status keep one retry. Per-query
// `retry` overrides (e.g. the voices query's `retry: false`) still win.
//---------------
export const MAX_QUERY_RETRIES = 1;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpStatusError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
