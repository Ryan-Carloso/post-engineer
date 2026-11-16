import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { ApiError, getErrorMessage } from './errors.js';
import { sanitizeEngineError } from './tools.js';
import type { McpToolResponse } from './tools-call.js';
import { parseContractResponse } from './contract-response.js';
import { listPinterestBoards as listPinterestBoardsContract } from './contracts/accounts.js';

//---------------
// accounts (action: list_boards) — the board picker for Pinterest publishing.
//
// Pinterest pins cannot exist without a board, so generate_video
// and publish_video (action: from_file) take the board id separately from the account
// ids. The web route lists the boards of one connected Pinterest account
// (the account id is the v5 user_account id stored at OAuth time); an
// expired access token is refreshed server-side before listing.
//---------------

export const ListPinterestBoardsShape = {
  accountId: z
    .string()
    .min(1, 'accountId is required')
    // The route trims and rejects a blank id, so the tool does too.
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
