//---------------
// MCP analytics: track tool invocations as PostHog product-analytics events.
//
// The MCP server is a local stdio process used heavily by AI agents; these
// events show which tools are actually used (1M/month free).
//
// posthog-node is lazy-loaded (dynamic import) so a missing/incompatible
// SDK never breaks module load — the MCP server must start even on older
// Node versions. Telemetry degrades to disabled.
//
// Safety rules:
// - Never throws: telemetry must never break the MCP server.
// - No-op when POSTHOG_API_KEY is missing (warns once to stderr).
// - Secret-bearing property keys are redacted before capture.
// - Never log PII, credentials, or raw request bodies in properties.
// - Reads configuration from environment variables only — never hardcode.
//---------------

// Property keys matching this pattern are redacted before capture.
// Matched case-insensitively; the key is kept so the field's presence
// stays visible for debugging, but the value is replaced.
const SECRET_KEY_PATTERN =
  /password|passwd|secret|token|authorization|auth\b|api[-_]?key|bearer|credential|private[-_]?key|session/i;

const REDACTED = '[redacted]';

function scrubSecrets(properties: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    scrubbed[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return scrubbed;
}

//---------------
// Default PostHog ingest host. Change this constant if you self-host
// PostHog — every telemetry path in the MCP server reads it as the
// fallback when POSTHOG_HOST is not set.
//---------------
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

interface PostHogClient {
  capture(args: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
}

let client: PostHogClient | null = null;
let warned = false;
let clientPromise: Promise<PostHogClient | null> | null = null;

async function getClient(): Promise<PostHogClient | null> {
  if (client !== null) return client;
  // Cache the in-flight promise: concurrent trackEvent calls during the
  // lazy import wait for the same load instead of dropping events.
  if (clientPromise !== null) return clientPromise;
  clientPromise = (async (): Promise<PostHogClient | null> => {
    const apiKey = process.env['POSTHOG_API_KEY'];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      if (!warned) {
        warned = true;
        console.warn('[mcp-analytics] POSTHOG_API_KEY not set — analytics disabled');
      }
      return null;
    }

    try {
      // Dynamic import: a missing or incompatible posthog-node never breaks
      // module load. The MCP server declares node >=20.10; posthog-node 5.x
      // wants >=20.20 — on older Node this catch degrades to disabled.
      const { PostHog } = await import('posthog-node');
      const host = process.env['POSTHOG_HOST'] ?? DEFAULT_POSTHOG_HOST;
      client = new PostHog(apiKey, { host }) as unknown as PostHogClient;
      return client;
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn('[mcp-analytics] PostHog init failed — analytics disabled:', error);
      }
      return null;
    }
  })();
  return clientPromise;
}

//---------------
// Track a product-analytics event (e.g. 'mcp_tool_called').
// eventName should be snake_case. properties carries safe context only:
// tool names, counts, validated enums — never credentials or raw bodies.
//---------------

export function trackEvent(eventName: string, properties?: Record<string, unknown>): void {
  try {
    const props = scrubSecrets({ ...(properties ?? {}) });
    // Fire-and-forget: the lazy SDK load happens async. Telemetry must
    // never block or break the MCP server.
    void getClient().then((posthog) => {
      if (posthog === null) return;
      try {
        posthog.capture({
          distinctId: 'post-engineer-mcp',
          event: eventName,
          properties: props,
        });
      } catch {
        // Telemetry must never break the MCP server.
      }
    });
  } catch {
    // Telemetry must never break the MCP server.
  }
}

//---------------
// Test seam: reset the cached client between tests.
// Not used in production code.
//---------------

export function resetAnalyticsForTesting(): void {
  client = null;
  warned = false;
  clientPromise = null;
}
