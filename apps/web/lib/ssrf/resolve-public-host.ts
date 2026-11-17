import { isIP } from 'node:net';

import { isPublicIp, unbracketIpLiteral } from '@/lib/ssrf/public-ip';

export type PublicHostLookup = (
  hostname: string,
  options: { all: true },
) => Promise<ReadonlyArray<{ address: string }>>;

export type PublicHostResult =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: 'unresolved' | 'not-public' };

// One DNS check for a URL host. Bracketed IPv6 literals skip DNS and are
// classified as the address inside the brackets. Fail closed on resolver
// errors, an empty answer, or any non-public address.
// `isPublic` is the caller's isPublicIp binding so a test double on that
// import (the avatar download suite) still applies.
export async function resolvePublicHost(
  hostname: string,
  lookupImpl: PublicHostLookup,
  isPublic: (ip: string) => boolean = isPublicIp,
): Promise<PublicHostResult> {
  const host = unbracketIpLiteral(hostname);
  let records: ReadonlyArray<{ address: string }>;
  try {
    records = isIP(host) !== 0 ? [{ address: host }] : await lookupImpl(host, { all: true });
  } catch {
    return { ok: false, reason: 'unresolved' };
  }
  const addresses = records.map((record) => record.address);
  if (addresses.length === 0 || !addresses.every((address) => isPublic(address))) {
    return { ok: false, reason: 'not-public' };
  }
  return { ok: true, addresses };
}
