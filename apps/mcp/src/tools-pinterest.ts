import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { ApiError, getErrorMessage } from './errors.js';
import { sanitizeEngineError } from './tools.js';
import type { McpToolResponse } from './tools-call.js';

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
    .describe('The Pinterest account ID (the providerAccountId field from accounts (action: list)).'),
};

export const ListPinterestBoardsSchema = z.object(ListPinterestBoardsShape);

interface PinterestBoard {
  id: string;
  name: string;
}

function narrowBoards(value: unknown): PinterestBoard[] {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { boards?: unknown }).boards)) {
    throw new Error('Malformed boards response from the API.');
  }
  return (value as { boards: unknown[] }).boards.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== 'string' ||
      typeof (entry as { name?: unknown }).name !== 'string'
    ) {
      throw new Error('Malformed boards response from the API.');
    }
    return { id: (entry as { id: string }).id, name: (entry as { name: string }).name };
  });
}

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
    const boards = narrowBoards(result);
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
