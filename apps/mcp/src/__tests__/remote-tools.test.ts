import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('runs the persona handlers on both transports and the local-file handlers on stdio', async () => {
    async function callTool(transport: 'stdio' | 'http', name: string, args: Record<string, unknown>) {
      const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, transport);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      try {
        return await client.callTool({ name, arguments: args });
      } finally {
        await client.close();
      }
    }

    for (const transport of ['http', 'stdio'] as const) {
      const created = await callTool(transport, 'create_persona', {
        name: 'Ava',
        avatarUrl: 'https://example.com/face.png',
        voiceId: 'alloy',
      });
      const updated = await callTool(transport, 'update_persona', { personaId: 'p1', name: 'Ava 2' });
      expect(created.isError).toBe(true);
      expect(updated.isError).toBe(true);
    }

    for (const [name, args] of [
      ['upload_media', { path: '/no/such-image.png' }],
      ['add_persona_image', { personaId: 'p1', path: '/no/such-image.png' }],
      ['publish_video_direct', { provider: 'instagram', videoPath: '/no/such-video.mp4', accountIds: ['ig-1'], caption: 'hi' }],
    ] as const) {
      const result = await callTool('stdio', name, args);
      expect(result.isError).toBe(true);
    }
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

describe('remote smuggled paths are dropped by the SDK, never read', () => {
  // The SDK parses tool args with the registered raw shape, which strips
  // unknown keys before the handler runs — so a smuggled path is dropped
  // (never read), not loudly rejected. These tests pin the actual outcome
  // at the transport boundary, through tools/call, not through safeParse.
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  function stubClient() {
    const createPersona = vi.fn().mockResolvedValue({ id: 'p1', name: 'Ava' });
    const updatePersona = vi.fn().mockResolvedValue({ id: 'p1', name: 'Ava 2' });
    const request = vi.fn().mockResolvedValue({ success: true, voice: { id: 'v1', status: 'ready' } });
    const client = {
      createPersona,
      updatePersona,
      getHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
      request,
      baseUrl: 'https://api.test',
    } as unknown as PostEngineerClient;
    return { client, createPersona, updatePersona, request };
  }

  async function callRemoteTool(client: PostEngineerClient, name: string, args: Record<string, unknown>) {
    const server = createPostEngineerMcpServer(client, 'http');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
    try {
      return await mcpClient.callTool({ name, arguments: args });
    } finally {
      await mcpClient.close();
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function firstText(result: unknown): string {
    if (!isRecord(result)) return '';
    const content = result.content;
    if (!Array.isArray(content)) return '';
    const block = content[0];
    if (!isRecord(block)) return '';
    return typeof block.text === 'string' ? block.text : '';
  }

  it('create_persona over HTTP with only a smuggled avatarPath fails the face check', async () => {
    const { client, createPersona } = stubClient();
    const result = await callRemoteTool(client, 'create_persona', {
      name: 'Ava',
      voiceId: 'no-voice',
      avatarPath: '/etc/passwd.png',
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('avatarUrl or avatarPath is required');
    expect(createPersona).not.toHaveBeenCalled();
  });

  it('create_persona over HTTP with avatarUrl and a smuggled avatarPath keeps only the URL', async () => {
    const { client, createPersona } = stubClient();
    const result = await callRemoteTool(client, 'create_persona', {
      name: 'Ava',
      voiceId: 'no-voice',
      avatarUrl: 'https://example.com/face.png',
      avatarPath: '/etc/passwd.png',
    });
    expect(result.isError).toBeUndefined();
    expect(createPersona).toHaveBeenCalledTimes(1);
    expect(createPersona.mock.calls[0][0]).toEqual(
      expect.objectContaining({ avatarUrl: 'https://example.com/face.png' }),
    );
    expect(createPersona.mock.calls[0][0]).not.toHaveProperty('avatarPath');
  });

  it('update_persona over HTTP with only a smuggled avatarPath updates nothing from the path', async () => {
    const { client, updatePersona } = stubClient();
    const result = await callRemoteTool(client, 'update_persona', {
      personaId: 'p1',
      avatarPath: '/etc/passwd.png',
    });
    expect(result.isError).toBeUndefined();
    expect(updatePersona).toHaveBeenCalledTimes(1);
    expect(updatePersona).toHaveBeenCalledWith({ personaId: 'p1' });
  });

  it('create_cloned_voice over HTTP with a smuggled audioPath clones from the URL', async () => {
    const { client, request } = stubClient();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'audio/mpeg' : null) },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await callRemoteTool(client, 'create_cloned_voice', {
      audioUrl: 'https://example.com/voice.mp3',
      audioPath: '/tmp/voice.mp3',
      language: 'en',
      consent: true,
      denoise: true,
    });
    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/voice.mp3', expect.anything());
    expect(request).toHaveBeenCalledWith(
      '/api/persona/cloned-voices',
      expect.objectContaining({ method: 'POST' }),
      'create cloned voice',
      expect.any(Number),
    );
    const body = request.mock.calls[0][1].body as FormData;
    expect((body.get('file') as File).name).toBe('reference.bin');
  });

  it('remote URL field descriptions never name the local-path field', async () => {
    const tools = await listTools('http');
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema.properties ?? {}]));
    const personaProps = byName.get('create_persona') as Record<string, { description?: string }>;
    expect(personaProps.avatarUrl.description).toBeDefined();
    expect(personaProps.avatarUrl.description).not.toContain('avatarPath');
    const voiceProps = byName.get('create_cloned_voice') as Record<string, { description?: string }>;
    expect(voiceProps.audioUrl.description).toBeDefined();
    expect(voiceProps.audioUrl.description).not.toContain('audioPath');
  });
});
