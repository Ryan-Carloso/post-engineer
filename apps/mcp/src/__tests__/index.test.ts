import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createPostEngineerMcpServer, isMainModule, requireApiKey } from '../index.js';
import type { PostEngineerClient } from '../client.js';

vi.mock('../analytics.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../analytics.js')>();
  return {
    ...original,
    mcpTelemetryHeaders: () => ({}),
    // Passthrough stand-ins for the per-call context: mcp_tool_called is
    // recorded by the web API from the request headers, not by the MCP
    // (see analytics.test.ts).
    withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
    withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
    withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
  };
});

// Issue #566: 16 intent tools instead of one tool per endpoint. Each action
// tool advertises ONE flat object (a required `action` enum plus every field
// of every action, optional); tools without actions keep their own shape.
const ACTIONS: Record<string, string[]> = {
  video_tasks: ['status', 'list_generations', 'get_generation'],
  personas: ['list', 'get', 'create', 'update', 'delete'],
  persona_media: ['list_faces', 'list_images', 'add_image', 'update_image', 'remove_image'],
  voices: ['list', 'preview', 'list_clones', 'create_clone', 'get_clone', 'preview_clone', 'delete_clone'],
  accounts: ['list', 'connect', 'disconnect', 'get_persona_publishing', 'set_persona_publishing', 'list_boards'],
  schedules: ['list', 'cancel', 'get_slot', 'update_slot_title', 'delete_slot'],
  posts: ['list', 'get'],
  insights: ['post_metrics', 'retention_curve'],
  experiments: ['create', 'list', 'add_pair', 'results'],
  media: ['upload', 'check'],
  billing: ['balance', 'transactions'],
  prompts: ['list', 'get'],
  check_script: ['validate', 'score'],
  publish_video: ['from_file', 'create_upload', 'complete_upload', 'publish_upload'],
};
const SINGLE_TOOLS: Record<string, string[]> = { generate_video: ['videos'], cancel_video: ['taskId'] };
const EXPECTED_TOOLS = [...Object.keys(ACTIONS), ...Object.keys(SINGLE_TOOLS)].sort();

// Actions that read a file from the disk exist only on the stdio server.
const LOCAL_ONLY: Record<string, string[]> = { persona_media: ['add_image'], media: ['upload'], publish_video: ['from_file'] };

async function listTools(transport: 'stdio' | 'http'): Promise<Map<string, Tool>> {
  const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return new Map(tools.map((tool) => [tool.name, tool]));
  } finally {
    await client.close();
  }
}

function actionsOf(tool: Tool | undefined): string[] {
  const action = (tool?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.action;
  return action?.enum ?? [];
}

describe('createPostEngineerMcpServer', () => {
  it.each(['stdio', 'http'] as const)('registers exactly the 16 intent tools on the %s server', async (transport) => {
    expect([...(await listTools(transport)).keys()].sort()).toEqual(EXPECTED_TOOLS);
  });

  it('does not require environment variables when a client is injected', () => {
    expect(() => createPostEngineerMcpServer({} as unknown as PostEngineerClient)).not.toThrow();
  });

  it('exposes a description for every tool', async () => {
    for (const [name, tool] of await listTools('stdio')) {
      expect(tool.description, `tool ${name} has no description`).toBeTruthy();
    }
  });
});

describe('action tools advertise one flat schema', () => {
  it.each(Object.entries(ACTIONS))('%s offers its actions on the stdio server and takes only `action` as required', async (name, actions) => {
    const tool = (await listTools('stdio')).get(name);
    expect(actionsOf(tool)).toEqual(actions);
    expect(tool?.inputSchema.required).toEqual(['action']);
    // The flat shape carries the fields of the actions, not an empty object.
    expect(Object.keys(tool?.inputSchema.properties ?? {}).length).toBeGreaterThan(1 + (actions.length === 0 ? 0 : 0));
  });

  it.each(Object.entries(SINGLE_TOOLS))('%s keeps its own required fields and has no action', async (name, required) => {
    const tool = (await listTools('stdio')).get(name);
    expect(tool?.inputSchema.required).toEqual(required);
    expect(tool?.inputSchema.properties).not.toHaveProperty('action');
  });

  it('keeps tools without field shared actions honest: every action name is lowercase snake_case', () => {
    for (const actions of Object.values(ACTIONS)) {
      for (const action of actions) expect(action).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it.each(Object.entries(LOCAL_ONLY))('%s offers %s only on the stdio server, never over HTTP', async (name, actions) => {
    const stdio = actionsOf((await listTools('stdio')).get(name));
    const http = actionsOf((await listTools('http')).get(name));
    for (const action of actions) {
      expect(stdio).toContain(action);
      expect(http).not.toContain(action);
    }
    expect(http).toEqual(ACTIONS[name].filter((action) => !actions.includes(action)));
  });

  it('never advertises a local file path field on the remote server', async () => {
    const tools = await listTools('http');
    for (const tool of tools.values()) {
      const fields = Object.keys(tool.inputSchema.properties ?? {});
      for (const forbidden of ['avatarPath', 'audioPath', 'videoPath', 'path']) {
        expect(fields, `${tool.name} offers ${forbidden} over HTTP`).not.toContain(forbidden);
      }
    }
  });

  it('never tells the remote server\'s agent to use an action it does not offer', async () => {
    const remote = await listTools('http');
    expect(remote.get('media')?.description).not.toContain('use upload');
    expect(remote.get('media')?.description).toContain('another public URL');
    expect(remote.get('persona_media')?.description).not.toContain('add_image');
    expect(remote.get('publish_video')?.description).not.toContain('from_file');
    const stdio = await listTools('stdio');
    expect(stdio.get('media')?.description).toContain('use upload');
  });

  it('names the required fields of each action in the description, so a flat schema stays usable', async () => {
    const tools = await listTools('stdio');
    expect(tools.get('personas')?.description).toContain('create (');
    expect(tools.get('personas')?.description).toContain('delete (persona)');
    expect(tools.get('accounts')?.description).toContain('disconnect (account)');
  });

  it('keeps the whole tools/list payload at least 40% below the 102,160 bytes of the 56 endpoint-mirror tools', async () => {
    const tools = [...(await listTools('stdio')).values()];
    const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    expect(bytes).toBeLessThanOrEqual(102_160 * 0.6);
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
    vi.stubEnv('POST_ENGINEER_API_KEY', '');
    try {
      expect(() => createPostEngineerMcpServer()).toThrow('POST_ENGINEER_API_KEY is required');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('every action runs its handler against the client', () => {
  // The action handlers only execute when the action is called: drive each
  // one that goes through a client method over the in-memory transport.
  const PERSONA = '11111111-1111-4111-8111-111111111111';
  const mockClient = {
    listVoices: vi.fn(),
    listPersonas: vi.fn(),
    listFaces: vi.fn(),
    listPersonaImages: vi.fn(),
    listSocialAccounts: vi.fn(),
    listSchedules: vi.fn(),
    cancelSchedule: vi.fn(),
    getSlot: vi.fn(),
    updateSlotTitle: vi.fn(),
    deleteSlot: vi.fn(),
    listVideoGenerations: vi.fn(),
    getVideoGeneration: vi.fn(),
    listTokenTransactions: vi.fn(),
    getTokenBalance: vi.fn(),
    disconnectAccount: vi.fn(),
    deletePersonaImage: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function call(name: string, args: Record<string, unknown>) {
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      return await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
    }
  }

  const CASES: Array<[string, Record<string, unknown>, keyof PostEngineerClient, unknown]> = [
    ['voices', { action: 'list' }, 'listVoices', { voices: [{ id: 'alloy', kind: 'standard' }] }],
    ['personas', { action: 'list' }, 'listPersonas', { personas: [] }],
    ['persona_media', { action: 'list_faces' }, 'listFaces', { faces: [] }],
    ['persona_media', { action: 'list_images', persona: PERSONA }, 'listPersonaImages', { images: [] }],
    ['persona_media', { action: 'remove_image', id: 'img1' }, 'deletePersonaImage', { success: true }],
    ['accounts', { action: 'list' }, 'listSocialAccounts', { accounts: [] }],
    ['accounts', { action: 'disconnect', account: 'did:plc:x', provider: 'bluesky' }, 'disconnectAccount', { success: true }],
    ['schedules', { action: 'list' }, 'listSchedules', { schedules: [] }],
    ['schedules', { action: 'cancel', scheduleId: 's1' }, 'cancelSchedule', { success: true }],
    ['schedules', { action: 'get_slot', slotId: 's1' }, 'getSlot', { slot: { id: 's1' } }],
    ['schedules', { action: 'update_slot_title', slotId: 's1', title: 'T' }, 'updateSlotTitle', { title: 'T' }],
    ['schedules', { action: 'delete_slot', slotId: 's1' }, 'deleteSlot', { success: true }],
    ['video_tasks', { action: 'list_generations' }, 'listVideoGenerations', { generations: [] }],
    ['video_tasks', { action: 'get_generation', generationId: 'g1' }, 'getVideoGeneration', { generation: { generationId: 'g1' } }],
    ['billing', { action: 'balance' }, 'getTokenBalance', { balance: 3 }],
    ['billing', { action: 'transactions' }, 'listTokenTransactions', { transactions: [], total: 0 }],
  ];

  it.each(CASES)('%s %j calls %s', async (name, args, method, payload) => {
    if (name === 'accounts' && args.action === 'disconnect') {
      vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({ accounts: [{ provider: 'bluesky', did: 'did:plc:x', handle: 'a.bsky.social' }] });
    }
    vi.mocked(mockClient[method] as ReturnType<typeof vi.fn>).mockResolvedValue(payload);
    const result = await call(name, args);
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(mockClient[method]).toHaveBeenCalled();
  });

  it('propagates a client error as an isError result', async () => {
    vi.mocked(mockClient.listVoices).mockRejectedValue(new Error('down'));
    expect((await call('voices', { action: 'list' })).isError).toBe(true);
  });

  it('rejects a field of another action before any request is sent', async () => {
    const result = await call('personas', { action: 'list', name: 'Maria' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('personas · list');
    expect(mockClient.listPersonas).not.toHaveBeenCalled();
  });

  it('resolves a persona given by name before the call', async () => {
    vi.mocked(mockClient.listPersonas).mockResolvedValue({ personas: [{ id: PERSONA, name: 'Maria' }] });
    vi.mocked(mockClient.listPersonaImages).mockResolvedValue({ images: [] });
    const result = await call('persona_media', { action: 'list_images', persona: 'maria' });
    expect(result.isError).toBeFalsy();
    expect(mockClient.listPersonaImages).toHaveBeenCalledWith(PERSONA);
  });

  it('answers an unknown persona name with the way to list them and calls nothing else', async () => {
    vi.mocked(mockClient.listPersonas).mockResolvedValue({ personas: [{ id: PERSONA, name: 'Maria' }] });
    const result = await call('persona_media', { action: 'list_images', persona: 'Ghost' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('No persona named');
    expect(mockClient.listPersonaImages).not.toHaveBeenCalled();
  });

  it('filters the accounts list by network', async () => {
    vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({ accounts: [{ provider: 'youtube', channelId: 'UC1' }, { provider: 'bluesky', did: 'd1' }] });
    const result = await call('accounts', { action: 'list', provider: 'bluesky' });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text).accounts).toEqual([{ provider: 'bluesky', did: 'd1' }]);
  });
});
