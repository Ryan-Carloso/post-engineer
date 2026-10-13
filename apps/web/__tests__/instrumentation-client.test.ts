//---------------
// instrumentation-client — browser PostHog initialization.
//
// The client path reads the SAME NEXT_PUBLIC_POSTHOG_HOST as the server SDK,
// so it needs the same validation. A project API key misconfigured as the
// host (production incident, 2026-10-13) was guarded on the server side by
// lib/posthog-server.ts while instrumentation-client.ts still passed the raw
// value straight to posthog-js, which accepts any string and fails only at
// send time — one bad value would keep breaking browser telemetry.
//
// These tests pin the host actually handed to posthog.init.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const initArgs: unknown[][] = [];

vi.mock('posthog-js', () => ({
  default: {
    init: (...args: unknown[]) => {
      initArgs.push(args);
    },
  },
}));

import { DEFAULT_POSTHOG_HOST } from '@/lib/posthog-config';

const misconfiguredHost = 'phc_notARealProjectKey0000000000000000000000000';

async function loadClient(host: string | undefined): Promise<void> {
  vi.resetModules();
  initArgs.length = 0;
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_key');
  if (host === undefined) {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', undefined);
  } else {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', host);
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await import('@/instrumentation-client');
}

function lastApiHost(): unknown {
  const options = initArgs[0]?.[1] as { api_host?: unknown };
  return options?.api_host;
}

describe('instrumentation-client PostHog host', () => {
  beforeEach(() => {
    initArgs.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('passes the default ingest host when no host is configured', async () => {
    await loadClient(undefined);
    expect(lastApiHost()).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('passes the default ingest host for the documented empty value', async () => {
    await loadClient('');
    expect(lastApiHost()).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('rejects a project API key used as the host', async () => {
    await loadClient(misconfiguredHost);
    expect(lastApiHost()).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('never logs the rejected host value', async () => {
    await loadClient(misconfiguredHost);
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((call) => call.map(String).join(' '))
      .join('\n');
    expect(warnings).toContain('NEXT_PUBLIC_POSTHOG_HOST');
    expect(warnings).not.toContain(misconfiguredHost);
  });

  it.each([
    ['a bare host without scheme', 'eu.i.posthog.com'],
    ['a non-http scheme', 'javascript:alert(1)'],
  ])('rejects %s', async (_label, host) => {
    await loadClient(host);
    expect(lastApiHost()).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('honors a valid custom self-hosted URL', async () => {
    await loadClient('https://posthog.internal.example:8000');
    expect(lastApiHost()).toBe('https://posthog.internal.example:8000');
  });

  // "HTTPS or loopback only" — plaintext http to a remote host would send
  // telemetry unencrypted. Loopback stays allowed for a local self-hoster.
  it('rejects a remote http host', async () => {
    await loadClient('http://posthog.internal.example:8000');
    expect(lastApiHost()).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('still allows a loopback http host', async () => {
    await loadClient('http://localhost:8000');
    expect(lastApiHost()).toBe('http://localhost:8000');
  });
});