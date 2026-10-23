import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cancelVideoTask } from '../client-video-task.js';
import {
  CancelVideoTaskSchema,
  handleCancelVideoTask,
} from '../video-task-tools.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

const mockTrackEvent = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const HEADERS = { Authorization: 'Bearer test-token' };

function fakeClient(request: ReturnType<typeof vi.fn>): PostEngineerClient {
  return {
    request,
    getHeaders: vi.fn().mockReturnValue(HEADERS),
  } as unknown as PostEngineerClient;
}

function textOf(response: unknown): string {
  const content = (response as { content?: unknown }).content as McpToolResponse['content'];
  const block = content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

describe('cancelVideoTask', () => {
  it('DELETEs the task with the id percent-encoded', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'deleted' });
    await cancelVideoTask(fakeClient(request), 'batch:s-1:slot:a/b');
    expect(request).toHaveBeenCalledWith(
      '/api/persona/video-task/batch%3As-1%3Aslot%3Aa%2Fb',
      { method: 'DELETE', headers: HEADERS },
      'cancel video task',
    );
  });
});

describe('CancelVideoTaskSchema', () => {
  it('requires a non-empty taskId', () => {
    expect(CancelVideoTaskSchema.safeParse({}).success).toBe(false);
    expect(CancelVideoTaskSchema.safeParse({ taskId: '' }).success).toBe(false);
    expect(CancelVideoTaskSchema.safeParse({ taskId: 'task-1' }).success).toBe(true);
  });
});

describe('handleCancelVideoTask', () => {
  it('returns the engine response', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'deleted' });
    const result = await handleCancelVideoTask(fakeClient(request), { taskId: 'task-1' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ status: 'deleted' });
  });

  it('maps failures to an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Video task not found.'));
    const result = await handleCancelVideoTask(fakeClient(request), { taskId: 'missing' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error cancelling video task: Video task not found.');
  });
});

describe('registered cancel_video_task tool', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  async function callTool(name: string, args: Record<string, unknown>, request: ReturnType<typeof vi.fn>) {
    const server = createPostEngineerMcpServer(fakeClient(request));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      return await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
    }
  }

  it('calls DELETE /api/persona/video-task/[taskId] and tracks the call', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'deleted' });
    const result = await callTool('cancel_video_task', { taskId: 'task-1' }, request);
    expect(result.isError).toBeFalsy();
    expect(request).toHaveBeenCalledWith(
      '/api/persona/video-task/task-1',
      { method: 'DELETE', headers: HEADERS },
      'cancel video task',
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('mcp_tool_called', { toolName: 'cancel_video_task' });
  });
});
