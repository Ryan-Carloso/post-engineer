import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { endpointSite } from './mcp-calls.js';

//---------------
// Behavioural proof for the parity gate: call a tool action through a real
// MCP client and record the HTTP requests it sends. The syntax-tree proof says
// an action's handler *can* reach an endpoint; this proves that invoking it
// does. `fetch` is replaced for the duration of the call only, so no request
// leaves the process; the stub answers 200 `{ success, body, data }` (or the
// JSON given for that `METHOD /path`, for an action that must read a listing
// before it sends its request) and the tool may then fail on the empty body,
// which does not matter: the request is what is asserted.
//---------------

export interface RecordedRequest {
  method: string;
  pathname: string;
}

/** Calls `tool` with `args` and returns every request it sent, in order. */
export async function callToolRecordingRequests(
  server: McpServer,
  tool: string,
  args: Record<string, unknown>,
  responses: Readonly<Record<string, unknown>> = {},
): Promise<RecordedRequest[]> {
  const recorded: RecordedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = { method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(), pathname: new URL(url).pathname };
    recorded.push(request);
    return Response.json(responses[`${request.method} ${request.pathname}`] ?? { success: true, body: {}, data: {} });
  };
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'parity-behaviour', version: '0.0.0' });
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    if (!tools.some((entry) => entry.name === tool)) throw new Error(`tool ${tool} is not registered in the server under test`);
    await client.callTool({ name: tool, arguments: args });
    return recorded;
  } finally {
    globalThis.fetch = original;
    await client.close();
    await server.close();
  }
}

/** Whether a recorded request matches an endpoint key (`GET /api/posts/[id]`): same method, same path shape. */
export function requestReaches(recorded: readonly RecordedRequest[], key: string): boolean {
  const wanted = endpointSite(key);
  const wantedSegments = wanted.path.split('/');
  return recorded.some((request) => {
    if (request.method !== wanted.method) return false;
    const segments = request.pathname.split('/');
    return (
      segments.length === wantedSegments.length &&
      wantedSegments.every((segment, index) => segment === '{}' || segment === segments[index])
    );
  });
}
