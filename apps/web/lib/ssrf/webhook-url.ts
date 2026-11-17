// Webhook-URL shape check shared by the web options validation. The
// web options pre-charge check (apps/web/app/api/videos/
// generate-and-schedule/options-validation.ts) must mirror the engine
// schema (apps/engine/app/models/schema.py) and the MCP schema
// (apps/mcp/src/schedule-shapes.ts isPublicHttpsWebhookUrl): rejecting
// here turns a charged slot dying with engine_rejected into a pre-charge
// 400 that names options.webhookUrl. Pinned to
// shared/ssrf/webhook-url-cases.json by __tests__/webhook-url.test.ts.

import { isIP } from 'node:net';

import { isPublicIp, unbracketIpLiteral } from '@/lib/ssrf/public-ip';

/** https only. A loopback or private literal host is rejected; a name is
 *  left to the engine (resolution happens on the delivery path). A
 *  malformed string is false, never a throw: callers report it as a
 *  validation issue. */
export function isPublicHttpsWebhookUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // URL.hostname keeps the brackets on an IPv6 literal (`[::1]`).
  const host = unbracketIpLiteral(parsed.hostname);
  if (host.toLowerCase() === 'localhost') return false;
  if (isIP(host) !== 0 && !isPublicIp(host)) return false;
  return true;
}
