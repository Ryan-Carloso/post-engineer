import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const { default: pkg } = await import('../package.json', { with: { type: 'json' } });

export const MCP_TOOL_HEADER = 'X-MCP-Tool';
export const MCP_CALL_ID_HEADER = 'X-MCP-Call-Id';
export const MCP_ACTION_HEADER = 'X-MCP-Action';
export const MCP_VERSION_HEADER = 'X-MCP-Version';

interface ToolCallContext {
  toolName: string;
  action?: string;
  callId: string;
}

const toolCallContext = new AsyncLocalStorage<ToolCallContext>();

const extraHeadersContext = new AsyncLocalStorage<() => Record<string, string>>();

export function withTelemetryHeaders<TResult>(headers: () => Record<string, string>, run: () => Promise<TResult>): Promise<TResult> {
  return extraHeadersContext.run(headers, run);
}

export function mcpTelemetryHeaders(options?: { includeVersion?: boolean }): Record<string, string> {
  const extras = extraHeadersContext.getStore();
  const headers: Record<string, string> = { ...(extras === undefined ? {} : extras()) };
  if (options?.includeVersion !== false) headers[MCP_VERSION_HEADER] = pkg.version;
  const context = toolCallContext.getStore();
  if (context !== undefined) {
    headers[MCP_TOOL_HEADER] = context.toolName;
    headers[MCP_CALL_ID_HEADER] = context.callId;
    if (context.action !== undefined) headers[MCP_ACTION_HEADER] = context.action;
  }
  return headers;
}

export function withToolCall<TResult>(toolName: string, action: string, run: () => Promise<TResult>): Promise<TResult> {
  return toolCallContext.run({ toolName, action, callId: randomUUID() }, run);
}

export function withTracking<TArgs extends Record<string, unknown>, TResult>(toolName: string, handler: (args: TArgs) => Promise<TResult>): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> =>
    toolCallContext.run({ toolName, callId: randomUUID() }, () => handler(args));
}
