import { HttpStatusError } from '@/lib/errors';

export async function parseJsonBody<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function throwForBadResponse(response: Response, fallback: string): Promise<never> {
  const data = await parseJsonBody<{ error?: string }>(response);
  const message = typeof data?.error === 'string' && data.error.length > 0 ? data.error : fallback;
  throw new HttpStatusError(message, response.status);
}
