import { createHash, randomBytes } from 'node:crypto';

export const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isShareTokenShape(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}

export function sharePathFor(token: string): string {
  return `/s/${token}`;
}
