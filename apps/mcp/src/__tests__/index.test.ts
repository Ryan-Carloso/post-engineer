import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer, isMainModule, requireApiKey } from '../index.js';
import type { PostEngineerClient } from '../client.js';

const EXPECTED_TOOLS = [
  'create_persona',
  'list_personas',
  'list_voices',
  'list_faces',
  'update_persona',
  'list_social_accounts',
  'connect_account',
  'list_schedules',
  'list_posts',
  'cancel_schedule',
  'get_token_balance',
  'generate_video_from_persona',
  'get_video_status',
  'schedule_video',
];

async function listServerToolNames(server: ReturnType<typeof createPostEngineerMcpServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

describe('createPostEngineerMcpServer', () => {
  const mockClient = {} as unknown as PostEngineerClient;

  it('registers exactly the expected tools', async () => {
    const server = createPostEngineerMcpServer(mockClient);
    const names = await listServerToolNames(server);
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('does not require environment variables when a client is injected', () => {
    expect(() => createPostEngineerMcpServer(mockClient)).not.toThrow();
  });

  it('exposes a description for every tool', async () => {
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.description, `tool ${tool.name} has no description`).toBeTruthy();
      }
    } finally {
      await client.close();
    }
  });
});

describe('isMainModule', () => {
  it('returns a boolean', () => {
    expect(typeof isMainModule()).toBe('boolean');
  });
});

describe('server version', () => {
  it('advertises the same version as package.json', async () => {
    const { default: pkg } = await import('../../package.json', { with: { type: 'json' } });
    const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(client.getServerVersion()?.version).toBe(pkg.version);
    } finally {
      await client.close();
    }
  });
});

describe('requireApiKey', () => {
  it('throws when POST_ENGINEER_API_KEY is missing', () => {
    expect(() => requireApiKey({})).toThrow('POST_ENGINEER_API_KEY is required');
  });

  it('returns the key when set', () => {
    expect(requireApiKey({ POST_ENGINEER_API_KEY: 'k' })).toBe('k');
  });
});

describe('createPostEngineerMcpServer without injected client', () => {
  it('throws when POST_ENGINEER_API_KEY is missing', () => {
    const prev = process.env.POST_ENGINEER_API_KEY;
    delete process.env.POST_ENGINEER_API_KEY;
    try {
      expect(() => createPostEngineerMcpServer()).toThrow('POST_ENGINEER_API_KEY is required');
    } finally {
      if (prev !== undefined) process.env.POST_ENGINEER_API_KEY = prev;
    }
  });
});
