import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getErrorMessage } from './errors.js';

export type McpToolResponse = CallToolResult;

export async function handleLibraryCall<Result>(
  clientCall: () => Promise<Result>,
  errorVerb: string,
  successPrefix?: string | ((result: Result) => string),
): Promise<McpToolResponse> {
  try {
    const result = await clientCall();
    const prefix = typeof successPrefix === 'function' ? successPrefix(result) : successPrefix;
    const text = prefix
      ? `${prefix}: ${JSON.stringify(result, null, 2)}`
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
