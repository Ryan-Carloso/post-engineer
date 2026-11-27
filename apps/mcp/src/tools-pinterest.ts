import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { ApiError, getErrorMessage } from './errors.js';
import { sanitizeEngineError } from './tools.js';
import type { McpToolResponse } from './tools-call.js';
import { parseContractResponse } from './contract-response.js';
import { listPinterestBoards as listPinterestBoardsContract } from './contracts/accounts.js';

const ListPinterestBoardsShape = {
  accountId: z
    .string()
    .min(1, 'accountId is required')
    .refine((value) => value.trim().length > 0, { message: 'accountId is required.' })
    .describe('The Pinterest account ID (the providerAccountId field from accounts (action: list)).'),
};

export const ListPinterestBoardsSchema = z.object(ListPinterestBoardsShape);

export async function handleListPinterestBoards(
  client: PostEngineerClient,
  args: z.infer<typeof ListPinterestBoardsSchema>,
): Promise<McpToolResponse> {
  try {
    const result = await client.request(
      `/api/pinterest/boards?accountId=${encodeURIComponent(args.accountId)}`,
      { method: 'GET', headers: client.getHeaders() },
      'list Pinterest boards',
    );
    const { boards } = parseContractResponse(listPinterestBoardsContract, result);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ boards }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing Pinterest boards: ${JSON.stringify({
              code: error.code,
              message: sanitizeEngineError(getErrorMessage(error)),
              field: error.field,
            })}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error listing Pinterest boards: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}
