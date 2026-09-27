import 'server-only';

import { createHash } from 'crypto';

//---------------
// PKCE (RFC 7636) — this server only accepts S256. `plain` and unknown
// methods are rejected: the secret never travels and a stolen code alone
// is worthless without the verifier.
//---------------

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64url');
}

export function verifyPkceChallenge(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== 'S256') return false;
  if (typeof verifier !== 'string' || !VERIFIER_PATTERN.test(verifier)) return false;
  if (typeof challenge !== 'string' || challenge.length === 0) return false;
  return sha256Base64Url(verifier) === challenge;
}
