// Response helpers for the client fetch layer.
//
// Extracted from lib/api.ts so the api module stays under the file-size
// ratchet. Both are used by every client fetcher that reads a JSON body
// or maps a failed response to an error.
import { HttpStatusError } from '@/lib/errors';

//---------------
// parseJsonBody — reads a JSON response body, tolerating non-JSON error
// pages (e.g. a Vercel 502 HTML body). Returns null instead of throwing.
//---------------
export async function parseJsonBody<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

//---------------
// throwForBadResponse — maps a non-OK response to a clean Error, preferring
// the server's error message when the body is JSON (exported for siblings).
//---------------
export async function throwForBadResponse(response: Response, fallback: string): Promise<never> {
  const data = await parseJsonBody<{ error?: string }>(response);
  const message = typeof data?.error === 'string' && data.error.length > 0 ? data.error : fallback;
  throw new HttpStatusError(message, response.status);
}
