// Web Standard request handler for the hosted remote MCP endpoint (issue #561).
//
// The standalone node:http listener (http-transport.ts) cannot run inside
// the web deploy, so the web's /mcp route handler drives the same remote
// server through this adapter instead: one Web Standard Request in, one
// Web Standard Response out. The transport is the SDK's
// WebStandardStreamableHTTPServerTransport — the same core the node:http
// transport wraps — in the same stateless mode (no session id, a fresh
// server per request) and with the same 1 MiB body cap. Auth, rate limits
// and the Origin guard live in the route handler; this module only speaks
// MCP over HTTP, exactly like serveHttpTransport does for node:http.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

// Maximum JSON-RPC request body accepted on /mcp (1 MiB). Keep in lockstep
// with MAX_BODY_BYTES in http-transport.ts: both are pinned by a 413 test
// in their own suite.
export const MAX_MCP_HTTP_BODY_BYTES = 1024 * 1024;

// Drive one MCP server over one Web Standard request. serverFactory builds
// a fresh server per call (the stateless transport cannot be reused, and a
// server binds to one transport), so the caller passes a factory, not a
// server — mirroring serveHttpTransport. The transport reads and parses
// the body itself so the 1 MiB cap applies; a pre-parsed body would bypass
// it.
//
// The server and transport close once the response body has been fully
// delivered (or abandoned), never before: handleRequest hands out the
// Response while the reply is still streaming (SSE), so closing in a
// finally here would abort the in-flight stream. The wrapper stream below
// forwards every chunk and closes on completion, error, or cancel.
export async function handleMcpWebRequest(
  request: Request,
  serverFactory: () => McpServer,
): Promise<Response> {
  const server = serverFactory();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    maxRequestBodySize: MAX_MCP_HTTP_BODY_BYTES,
  });
  let closed = false;
  const closeOnce = (): void => {
    if (closed) return;
    closed = true;
    // allSettled never rejects, so no rejection handler is needed here.
    void Promise.allSettled([transport.close(), server.close()]);
  };
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const body = response.body;
    if (body === null) {
      closeOnce();
      return response;
    }
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
          closeOnce();
        }
      },
      cancel() {
        closeOnce();
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    closeOnce();
    throw error;
  }
}
