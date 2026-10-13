//---------------
// PostHog host configuration.
//
// DEFAULT_POSTHOG_HOST is the fallback used when NEXT_PUBLIC_POSTHOG_HOST
// is not set. Change it here if you self-host PostHog — every telemetry
// path (browser client in instrumentation-client.ts, server SDK in
// lib/posthog-server.ts) reads this constant. Keep the value in sync with
// the engine (app/services/analytics.py) and MCP (src/analytics.ts)
// constants — lib/__tests__/posthog-config.test.ts enforces it.
//---------------

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

// Hosts where plaintext http is acceptable: a local self-hosted PostHog.
// Node's `new URL(...).hostname` KEEPS the brackets on an IPv6 literal
// ('[::1]', verified against node 22/24), so both spellings are listed
// rather than relying on normalization that does not happen.
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

//---------------
// Resolve the configured ingest host, refusing anything that is not an
// http(s) URL.
//
// posthog-js and posthog-node both accept ANY string as the host and only
// discover the problem later, when a capture is sent ("Network error while
// fetching PostHog"). In production (2026-10-13) NEXT_PUBLIC_POSTHOG_HOST
// was set to a project API key (phc_...) instead of an ingest URL: the
// client constructed fine, every send failed, and the failure was silent.
//
// Shared by BOTH consumers — the server SDK (lib/posthog-server.ts) and the
// browser client (instrumentation-client.ts) — so the same bad value cannot
// break one path while the other is fixed.
//
// The rejected value is never echoed into the warning: in this incident's
// shape the misconfigured value IS itself a credential.
//
// `warn` is injected so this leaf stays free of console side effects for the
// browser bundle (the server path passes its own warn-once helper).
//---------------
export function resolveHost(
  raw: string | undefined,
  warn: (message: string) => void,
): string {
  // Empty string is the documented "unset" case (.env.example ships an empty
  // value), so it falls through to the default without warning.
  if (raw === undefined || raw === '') return DEFAULT_POSTHOG_HOST;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    warn(
      '[posthog] NEXT_PUBLIC_POSTHOG_HOST is not a valid URL — falling back to the default ingest host. ' +
        'It must be an https:// ingest URL (e.g. https://eu.i.posthog.com), NOT a project API key.',
    );
    return DEFAULT_POSTHOG_HOST;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    warn(
      `[posthog] NEXT_PUBLIC_POSTHOG_HOST uses the unsupported scheme "${parsed.protocol}" — ` +
        'falling back to the default ingest host. It must be an https:// ingest URL, NOT a project API key.',
    );
    return DEFAULT_POSTHOG_HOST;
  }

  // HTTPS or loopback only — the house rule for outbound targets in this repo.
  // Plaintext http to a remote host would ship telemetry (and the API key in
  // the request path) unencrypted; loopback is exempt so a self-hoster can
  // still run PostHog locally over http.
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    warn(
      '[posthog] NEXT_PUBLIC_POSTHOG_HOST uses plaintext http on a remote host — ' +
        'falling back to the default ingest host. Use https:// (plain http is allowed only ' +
        'for localhost/127.0.0.1/[::1]).',
    );
    return DEFAULT_POSTHOG_HOST;
  }

  return raw;
}
