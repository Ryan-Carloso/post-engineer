import { isIP } from 'node:net';

import { isPublicIp, unbracketIpLiteral } from '@/lib/ssrf/public-ip';

export function isPublicHttpsWebhookUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = unbracketIpLiteral(parsed.hostname);
  if (host.toLowerCase() === 'localhost') return false;
  if (isIP(host) !== 0 && !isPublicIp(host)) return false;
  return true;
}
