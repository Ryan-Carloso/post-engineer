import 'server-only';

/** Shared engine base URL (throws when MONEYPRINT_API_URL is unset). */
export function engineBaseUrl(): string {
  const url = process.env.MONEYPRINT_API_URL;
  if (!url) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  return url.replace(/\/+$/, '');
}

export interface EngineEnvelope<T = unknown> {
  status?: number;
  message?: string;
  body?: T;
}

export async function parseEngineJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
