export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export function resolveHost(
  raw: string | undefined,
  warn: (message: string) => void,
): string {
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
