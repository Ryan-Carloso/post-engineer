import { isIP } from 'node:net';

import { isPublicIp, unbracketIpLiteral } from '@/lib/ssrf/public-ip';

export type PublicHostLookup = (
  hostname: string,
  options: { all: true },
) => Promise<ReadonlyArray<{ address: string }>>;

export type PublicHostResult =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: 'unresolved' | 'not-public' };

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
