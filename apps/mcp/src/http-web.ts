import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export const MAX_MCP_HTTP_BODY_BYTES = 1024 * 1024;

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
