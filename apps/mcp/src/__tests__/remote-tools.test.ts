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
import {
  CreateClonedVoiceRemoteSchema,
  CreateClonedVoiceRemoteShape,
} from '../cloned-voice-tools.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

const FILE_ONLY_TOOLS = ['upload_media', 'add_persona_image', 'publish_video_direct'];

async function listTools(transport: 'stdio' | 'http') {
  const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
  }
}

describe('remote (http) tool surface', () => {
  it('does not expose tools that read files from disk', async () => {
    const names = (await listTools('http')).map((t) => t.name);
    for (const tool of FILE_ONLY_TOOLS) {
      expect(names).not.toContain(tool);
    }
  });

  it('still exposes the JSON tools on http', async () => {
    const names = (await listTools('http')).map((t) => t.name);
    for (const tool of ['create_persona', 'update_persona', 'create_cloned_voice', 'check_media', 'generate_persona_video', 'list_personas']) {
      expect(names).toContain(tool);
    }
  });

  it('keeps every tool on stdio', async () => {
    const names = (await listTools('stdio')).map((t) => t.name);
    for (const tool of FILE_ONLY_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it('exposes no local-path field on http schemas', async () => {
    const tools = await listTools('http');
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema.properties ?? {}]));
    expect(byName.get('create_persona')).toHaveProperty('avatarUrl');
    expect(byName.get('create_persona')).not.toHaveProperty('avatarPath');
    expect(byName.get('create_persona')).not.toHaveProperty('images');
    expect(byName.get('create_persona')).not.toHaveProperty('imagePrimaryIndex');
    expect(byName.get('update_persona')).not.toHaveProperty('avatarPath');
    expect(byName.get('create_cloned_voice')).toHaveProperty('audioUrl');
    expect(byName.get('create_cloned_voice')).not.toHaveProperty('audioPath');
  });

  it('keeps local-path fields on stdio schemas', async () => {
    const tools = await listTools('stdio');
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema.properties ?? {}]));
    expect(byName.get('create_persona')).toHaveProperty('avatarPath');
    expect(byName.get('create_persona')).toHaveProperty('images');
    expect(byName.get('update_persona')).toHaveProperty('avatarPath');
    expect(byName.get('create_cloned_voice')).toHaveProperty('audioPath');
  });
});

describe('remote schemas reject local paths', () => {
  it('create_persona remote shape has no path or library fields', () => {
    expect(Object.keys(CreatePersonaRemoteShape)).not.toContain('avatarPath');
    expect(Object.keys(CreatePersonaRemoteShape)).not.toContain('images');
    expect(Object.keys(UpdatePersonaRemoteShape)).not.toContain('avatarPath');
  });

  it('create_cloned_voice remote schema accepts a URL and rejects a path', () => {
    const base = { audioUrl: 'https://example.com/voice.mp3', language: 'en', consent: true as const, denoise: true };
    expect(CreateClonedVoiceRemoteSchema.safeParse(base).success).toBe(true);
    expect(CreateClonedVoiceRemoteSchema.safeParse({ ...base, audioPath: '/tmp/voice.mp3' }).success).toBe(false);
    expect(Object.keys(CreateClonedVoiceRemoteShape)).not.toContain('audioPath');
  });

  it('persona remote schemas reject smuggled path fields', () => {
    const update = UpdatePersonaRemoteSchema.safeParse({ personaId: 'p1', avatarPath: '/etc/passwd.png' });
    expect(update.success).toBe(false);
    const create = CreatePersonaRemoteSchema.safeParse({
      name: 'Ava',
      avatarUrl: 'https://example.com/face.png',
      avatarPath: '/etc/passwd.png',
    });
    expect(create.success).toBe(false);
  });
});
