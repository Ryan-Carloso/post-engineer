import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Mock the analytics module before importing index (which imports it).
const trackEventMock = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
  resetAnalyticsForTesting: vi.fn(),
}));

import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';

describe('tool invocation tracking', () => {
  beforeEach(() => {
    trackEventMock.mockClear();
  });

  it('emits mcp_tool_called when a tool is invoked', async () => {
    const mockClient = {
      listPersonas: async () => [],
    } as unknown as PostEngineerClient;
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await client.callTool({ name: 'list_personas', arguments: {} });
      // trackEvent is fire-and-forget; allow the microtask to run.
      await new Promise((r) => setTimeout(r, 50));
      expect(trackEventMock).toHaveBeenCalledWith(
        'mcp_tool_called',
        expect.objectContaining({ toolName: 'list_personas' }),
      );
    } finally {
      await client.close();
    }
  });
});
