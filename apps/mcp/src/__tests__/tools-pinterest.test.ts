import { describe, it, expect, vi } from 'vitest';
import { handleListPinterestBoards } from '../tools-pinterest.js';
import type { PostEngineerClient } from '../client.js';
import { ApiError } from '../errors.js';
import type { McpToolResponse } from '../tools.js';

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

function mockClient() {
  return {
    request: vi.fn(),
    getHeaders: vi.fn().mockReturnValue({}),
  } as unknown as PostEngineerClient;
}

describe('list_pinterest_boards tool', () => {
  it('lists the boards of the account through the boards route', async () => {
    const client = mockClient();
    vi.mocked(client.request).mockResolvedValue({
      success: true,
      boards: [
        { id: 'b1', name: 'Board One' },
        { id: 'b2', name: 'Board Two' },
      ],
    });
    const response = await handleListPinterestBoards(client, { accountId: 'user-9' });
    expect(response.isError).toBeUndefined();
    expect(client.request).toHaveBeenCalledWith(
      '/api/pinterest/boards?accountId=user-9',
      { method: 'GET', headers: {} },
      'list_pinterest_boards',
    );
    expect(JSON.parse(textOf(response))).toEqual({
      boards: [
        { id: 'b1', name: 'Board One' },
        { id: 'b2', name: 'Board Two' },
      ],
    });
  });

  it('returns the API error code instead of a stack trace', async () => {
    const client = mockClient();
    vi.mocked(client.request).mockRejectedValue(new ApiError('Failed to list Pinterest boards.', 'PINTEREST_BOARDS_FAILED', null));
    const response = await handleListPinterestBoards(client, { accountId: 'user-9' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('PINTEREST_BOARDS_FAILED');
  });

  it('fails on a malformed boards response instead of reporting an empty list', async () => {
    const client = mockClient();
    vi.mocked(client.request).mockResolvedValue({ success: true, boards: 'not-an-array' });
    const response = await handleListPinterestBoards(client, { accountId: 'user-9' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Malformed boards response');
  });
});
