import { createHmac } from 'node:crypto';

import { deriveServerKey } from '@/lib/token-crypto';

export const QUOTE_TTL_MS = 15 * 60 * 1000;

const QUOTE_KEY_PURPOSE = 'post-engineer/experiment-quote/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]): [string, unknown] => [key, canonicalize(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function quoteKeyFor(value: unknown): string {
  return createHmac('sha256', deriveServerKey(QUOTE_KEY_PURPOSE)).update(canonicalJson(value)).digest('hex');
}

export function quoteExpiry(now: Date): string {
  return new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
}

export function isQuoteExpired(expiresAt: string, now: Date): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isNaN(expiry) || expiry <= now.getTime();
}
