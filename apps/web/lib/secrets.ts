import 'server-only';

import { timingSafeEqual } from 'node:crypto';

//---------------
// secretsMatch — constant-time comparison for shared secrets such as
// MONEYPRINT_API_SECRET. Never compare secrets with ===: it short-circuits
// on the first differing byte and leaks the secret prefix through timing.
//
// timingSafeEqual requires equal-length buffers, so inputs of different
// lengths are rejected up front. Empty inputs never match: a degenerate
// empty secret must not authenticate anything.
//---------------
export function secretsMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
