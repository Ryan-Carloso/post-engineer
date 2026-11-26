import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';

vi.mock('../analytics.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../analytics.js')>();
  return {
    ...original,
    mcpTelemetryHeaders: () => ({}),
    withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
    withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
    withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
  };
});

async function publishVideoDescription(transport: 'stdio' | 'http'): Promise<string> {
  const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.find((tool) => tool.name === 'publish_video')?.description ?? '';
  } finally {
    await client.close();
  }
}

describe('publish_video description', () => {
  it.each(['stdio', 'http'] as const)('lists the image networks and leaves YouTube out of them (%s)', async (transport) => {
    const description = await publishVideoDescription(transport);
    expect(description).toContain('images: instagram/bluesky/linkedin/threads/facebook/pinterest/telegram only; YouTube and the other networks take video');
    expect(description).not.toContain('Short');
  });
});
