import 'server-only';

import { timingSafeEqual } from 'node:crypto';

export function secretsMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
