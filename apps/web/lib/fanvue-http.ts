//---------------
// fanvue-http — the one place that talks to api.fanvue.com.
//
// Every API request needs `Authorization: Bearer <token>` plus the
// `X-Fanvue-API-Version` header. This module owns the shared pieces
// (base URL, version, JSON fetch and the response readers) so the
// OAuth client (lib/fanvue.ts), the vault upload (lib/fanvue-media.ts)
// and post creation (lib/fanvue-posts.ts) cannot drift apart.
//
// Non-2xx, a non-JSON body (a proxy can answer with HTML) and a
// non-object body are all failures; the message is "CODE: detail" so
// callers and telemetry read a stable code.
//---------------

import { FanvueError } from '@/lib/errors';

export const FANVUE_API_BASE = 'https://api.fanvue.com';
// Required on every api.fanvue.com request (not on the auth host).
export const FANVUE_API_VERSION = '2025-06-26';
const REQUEST_TIMEOUT_MS = 15_000;

export type JsonRecord = Record<string, unknown>;

export function requireFanvueEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new FanvueError(`FANVUE_ENV_MISSING: ${name} is not defined`, 500);
  }
  return value;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readOptionalString(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readOptionalNumber(body: JsonRecord, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readOptionalBoolean(body: JsonRecord, key: string): boolean | null {
  const value = body[key];
  return typeof value === 'boolean' ? value : null;
}

// Only Fanvue's own error message is surfaced, never the request itself.
function describeFailure(body: JsonRecord | null, status: number): string {
  const message =
    body === null
      ? null
      : (readOptionalString(body, 'message') ??
        readOptionalString(body, 'error_description') ??
        readOptionalString(body, 'error'));
  if (message !== null) return message;
  return `status ${status}`;
}

export async function fanvueFetch(
  code: string,
  url: string,
  init: RequestInit = {},
): Promise<JsonRecord> {
  const headers = {
    'X-Fanvue-API-Version': FANVUE_API_VERSION,
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    throw new FanvueError(`${code}: ${describeFailure(body, response.status)}`, response.status);
  }
  if (body === null) {
    throw new FanvueError(`${code}: invalid response body`, 502);
  }
  return body;
}

export function bearer(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

export function jsonBearer(accessToken: string): RequestInit {
  return {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  };
}
