import { getPostHogServer } from './posthog-server';
import { redactCredentialFragments } from './scrub';

//---------------
// MCP tool telemetry, recorded server-side.
//
// The MCP package never talks to PostHog: every API request it sends
// carries X-MCP-Tool / X-MCP-Call-Id / X-MCP-Version headers
// (apps/mcp/src/analytics.ts). requireSupabaseSession calls
// trackMcpToolCall on the API-key and OAuth branches only (a cookie session
// is the browser, never the MCP), and this module records one
// `mcp_tool_called` event per request against the authenticated user.
//
// - Headers are validated by format; an absent or malformed tool header
//   records nothing and never affects the request.
// - One tool call can send several API requests sharing one call id, so
//   PostHog counts tool calls with count(distinct properties.call_id).
// - requireSupabaseSession can run more than once for the same request
//   (the route, then resolveReportingUserId in withApiErrorReporting);
//   a WeakSet keeps it to one event per request.
// - `path` never carries caller text: dynamic segments (ids, the prompt
//   slug an agent typed) are replaced by `:param` unless they look like a
//   static route word, and the result still passes the credential-fragment
//   scrubber. Low cardinality, and a pasted token never reaches PostHog.
// - Never throws: telemetry must never break the request path.
//---------------

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,20})?$/;

export type McpAuthMethod = 'api_key' | 'oauth';

const trackedRequests = new WeakSet<Request>();

// A static route word: lowercase letters, digits and hyphens — but never a
// uuid-shaped id, which is a dynamic segment even when it starts with a
// letter (a-f-initial uuids otherwise match STATIC_SEGMENT verbatim).
const STATIC_SEGMENT = /^[a-z][a-z0-9-]{0,40}$/;

function telemetryPath(url: string): string {
  const segments = new URL(url).pathname.split('/').map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ':param';
    }
    return decoded === '' || (STATIC_SEGMENT.test(decoded) && !CALL_ID.test(decoded)) ? decoded : ':param';
  });
  return redactCredentialFragments(segments.join('/'));
}

function headerMatching(request: Request, name: string, pattern: RegExp): string | undefined {
  const value = request.headers.get(name);
  return value !== null && pattern.test(value) ? value : undefined;
}

export function trackMcpToolCall(request: Request, userId: string, authMethod: McpAuthMethod): void {
  try {
    if (trackedRequests.has(request)) return;
    const tool = headerMatching(request, 'x-mcp-tool', TOOL_NAME);
    if (tool === undefined) return;
    trackedRequests.add(request);
    const client = getPostHogServer();
    if (client === null) return;
    const properties: Record<string, unknown> = {
      tool,
      auth_method: authMethod,
      method: request.method,
      path: telemetryPath(request.url),
    };
    const callId = headerMatching(request, 'x-mcp-call-id', CALL_ID);
    if (callId !== undefined) properties.call_id = callId;
    const version = headerMatching(request, 'x-mcp-version', VERSION);
    if (version !== undefined) properties.mcp_version = version;
    client.captureAs(userId, 'mcp_tool_called', properties);
  } catch {
    // Telemetry must never break the request path.
  }
}
