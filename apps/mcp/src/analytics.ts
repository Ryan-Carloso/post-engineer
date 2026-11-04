import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

//---------------
// MCP tool telemetry, reported through the web API.
//
// The MCP server never talks to PostHog. Every request the server sends to
// the post-engineer API carries headers naming the MCP tool that triggered
// it; the web API validates them and records `mcp_tool_called` against the
// authenticated user (apps/web/lib/mcp-tool-telemetry.ts). Nothing to
// configure on the user side, and no analytics key ships in the package.
//
// withTracking() opens a per-invocation context (AsyncLocalStorage, so
// concurrent tool calls in the HTTP transport never mix their names) and
// mcpTelemetryHeaders() reads it when the API client builds its headers.
// One tool call can send several API requests; they share one call id so
// PostHog counts calls with count(distinct call_id).
//---------------

const { default: pkg } = await import('../package.json', { with: { type: 'json' } });

export const MCP_TOOL_HEADER = 'X-MCP-Tool';
export const MCP_CALL_ID_HEADER = 'X-MCP-Call-Id';
export const MCP_VERSION_HEADER = 'X-MCP-Version';

interface ToolCallContext {
  toolName: string;
  callId: string;
}

const toolCallContext = new AsyncLocalStorage<ToolCallContext>();

//---------------
// Extra telemetry headers for the current call, set by recipe-session.ts
// (recipe-adoption attribution). A function, not a snapshot, so a request
// sent late in the call reports the session state at send time. A
// separate store from toolCallContext: the extras wrap the handler inside
// withTracking and never replace the tool name or call id.
//---------------
const extraHeadersContext = new AsyncLocalStorage<() => Record<string, string>>();

export function withTelemetryHeaders<TResult>(headers: () => Record<string, string>, run: () => Promise<TResult>): Promise<TResult> {
  return extraHeadersContext.run(headers, run);
}

//---------------
// Headers for the current API request: the server version always, plus the
// tool name and call id when the request runs inside a tracked tool call.
//---------------
export function mcpTelemetryHeaders(): Record<string, string> {
  const extras = extraHeadersContext.getStore();
  const headers: Record<string, string> = { ...(extras === undefined ? {} : extras()), [MCP_VERSION_HEADER]: pkg.version };
  const context = toolCallContext.getStore();
  if (context !== undefined) {
    headers[MCP_TOOL_HEADER] = context.toolName;
    headers[MCP_CALL_ID_HEADER] = context.callId;
  }
  return headers;
}

//---------------
// Wrap a tool (or prompt) handler so every API request it sends is tagged
// with its name and a fresh call id.
//---------------
export function withTracking<TArgs extends Record<string, unknown>, TResult>(toolName: string, handler: (args: TArgs) => Promise<TResult>): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> =>
    toolCallContext.run({ toolName, callId: randomUUID() }, () => handler(args));
}
