import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import {
  CreatePersonaRemoteSchema,
  CreatePersonaRemoteShape,
  UpdatePersonaRemoteSchema,
  UpdatePersonaRemoteShape,
} from '../remote-shapes.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

const FILE_ONLY_ACTIONS: Array<[string, string]> = [['publish_video', 'from_file']];

function actionsOf(tools: Awaited<ReturnType<typeof listTools>>, name: string): string[] {
  const action = (tools.find((tool) => tool.name === name)?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.action;
  return action?.enum ?? [];
}

async function connect(client: PostEngineerClient, transport: 'stdio' | 'http') {
  const server = createPostEngineerMcpServer(client, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

async function listTools(transport: 'stdio' | 'http') {
  const mcpClient = await connect({} as unknown as PostEngineerClient, transport);
  try {
    return (await mcpClient.listTools()).tools;
  } finally {
    await mcpClient.close();
  }
}

describe('remote (http) tool surface', () => {
  it('does not offer the actions that read files from disk', async () => {
    const tools = await listTools('http');
    for (const [tool, action] of FILE_ONLY_ACTIONS) {
      expect(actionsOf(tools, tool)).not.toContain(action);
    }
  });

  it('still offers the JSON actions on http', async () => {
    const tools = await listTools('http');
    const names = tools.map((t) => t.name);
    for (const tool of ['personas', 'publish_video', 'schedules', 'posts']) expect(names).toContain(tool);
    expect(actionsOf(tools, 'personas')).toEqual(expect.arrayContaining(['create', 'update', 'list']));
    expect(actionsOf(tools, 'publish_video')).toEqual(['create_upload', 'complete_upload', 'publish_upload', 'publish_existing']);
  });

  it('keeps every action on stdio', async () => {
    const tools = await listTools('stdio');
    for (const [tool, action] of FILE_ONLY_ACTIONS) {
      expect(actionsOf(tools, tool)).toContain(action);
    }
  });

  it('exposes no local-path field on http schemas and keeps avatarPath on stdio', async () => {
    const http = new Map((await listTools('http')).map((t) => [t.name, t.inputSchema.properties ?? {}]));
    const stdio = new Map((await listTools('stdio')).map((t) => [t.name, t.inputSchema.properties ?? {}]));
    expect(http.get('personas')).not.toHaveProperty('avatarPath');
    expect(stdio.get('personas')).toHaveProperty('avatarPath');
  });

  it('registers no generation, voice, billing or media-check tool', async () => {
    const names = (await listTools('stdio')).map((tool) => tool.name);
    for (const gone of ['generate_video', 'video_tasks', 'cancel_video', 'voices', 'billing', 'media', 'check_script']) {
      expect(names).not.toContain(gone);
    }
  });
});

describe('remote schemas reject local paths', () => {
  it('create_persona remote shape has no path field', () => {
    expect(Object.keys(CreatePersonaRemoteShape)).not.toContain('avatarPath');
    expect(Object.keys(UpdatePersonaRemoteShape)).not.toContain('avatarPath');
  });

  it('create_persona remote schema requires at least one bound account (issue #572)', () => {
    expect(CreatePersonaRemoteSchema.safeParse({ name: 'Ava' }).success).toBe(false);
    expect(CreatePersonaRemoteSchema.safeParse({ name: 'Ava', accounts: { youtube: [] } }).success).toBe(false);
    expect(CreatePersonaRemoteSchema.safeParse({ name: 'Ava', accounts: { youtube: ['UC-1'] } }).success).toBe(true);
  });

  it('persona remote schemas reject smuggled path fields', () => {
    expect(CreatePersonaRemoteSchema.safeParse({ name: 'Ava', accounts: { youtube: ['UC-1'] }, avatarPath: '/etc/passwd' }).success).toBe(false);
    expect(UpdatePersonaRemoteSchema.safeParse({ personaId: 'p1', avatarPath: '/etc/passwd' }).success).toBe(false);
  });
});

describe('remote smuggled paths are dropped by the SDK, never read', () => {
  it('personas create over HTTP drops a smuggled avatarPath before the handler', async () => {
    const createPersona = vi.fn().mockResolvedValue({ success: true, personaId: 'p1' });
    const mcpClient = await connect({ createPersona } as unknown as PostEngineerClient, 'http');
    try {
      await mcpClient.callTool({
        name: 'personas',
        arguments: { action: 'create', name: 'Ava', accounts: { youtube: ['UC-1'] }, avatarPath: '/etc/passwd' },
      });
    } finally {
      await mcpClient.close();
    }
    const [input] = createPersona.mock.calls[0] ?? [];
    expect(input).toEqual({ name: 'Ava', accounts: { youtube: ['UC-1'] } });
  });
});
