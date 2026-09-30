import { PostHog } from 'posthog-node';

//---------------
// MCP analytics: track tool invocations as PostHog product-analytics events.
//
// The MCP server is a local stdio process used heavily by AI agents; these
// events show which tools are actually used (1M/month free).
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

let client: PostHog | null = null;
let warned = false;
let attempted = false;

function getClient(): PostHog | null {
  if (client !== null) return client;
  if (attempted) return null;
  attempted = true;

  const apiKey = process.env['POSTHOG_API_KEY'];
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    if (!warned) {
      warned = true;
      console.warn('[mcp-analytics] POSTHOG_API_KEY not set — analytics disabled');
    }
    return null;
  }

  try {
    const host = process.env['POSTHOG_HOST'] ?? 'https://us.i.posthog.com';
    client = new PostHog(apiKey, { host });
    return client;
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn('[mcp-analytics] PostHog init failed — analytics disabled:', error);
    }
    return null;
  }
}

//---------------
// Track a product-analytics event (e.g. 'mcp_tool_called').
// eventName should be snake_case. properties carries safe context only:
// tool names, counts, validated enums — never credentials or raw bodies.
//---------------

export function trackEvent(eventName: string, properties?: Record<string, unknown>): void {
  try {
    const posthog = getClient();
    if (posthog === null) return;
    const props = scrubSecrets({ ...(properties ?? {}) });
    posthog.capture({
      distinctId: 'post-engineer-mcp',
      event: eventName,
      properties: props,
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
  attempted = false;
}
