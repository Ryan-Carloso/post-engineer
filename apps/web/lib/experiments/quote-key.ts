import { createHash } from 'node:crypto';

export const QUOTE_TTL_MS = 15 * 60 * 1000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
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
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function quoteExpiry(now: Date): string {
  return new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
}

export function isQuoteExpired(expiresAt: string, now: Date): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isNaN(expiry) || expiry <= now.getTime();
}
