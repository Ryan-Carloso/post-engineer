import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getErrorMessage } from './errors.js';

export type McpToolResponse = CallToolResult;

/** Shared wrapper for simple list/mutate handlers (try/catch + JSON text). */
export async function handleLibraryCall(
  clientCall: () => Promise<unknown>,
  errorVerb: string,
  successPrefix?: string,
): Promise<McpToolResponse> {
  try {
    const result = await clientCall();
    const text = successPrefix
      ? `${successPrefix}: ${JSON.stringify(result, null, 2)}`
      : JSON.stringify(result, null, 2);
    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error ${errorVerb}: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}
