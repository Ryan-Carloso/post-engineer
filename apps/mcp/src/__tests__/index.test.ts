import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createPostEngineerMcpServer, isMainModule } from '../index.js';
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

const ACTIONS: Record<string, string[]> = {
  personas: ['list', 'get', 'create', 'update', 'delete'],
  persona_media: ['get_card', 'render_prompt'],
  accounts: ['list', 'connect', 'disconnect', 'get_persona_publishing', 'set_persona_publishing', 'list_boards'],
  tool_config: ['get', 'save'],
  schedules: ['list', 'cancel', 'get_slot', 'update_slot_title', 'delete_slot'],
  posts: ['list', 'get'],
  insights: ['post_metrics', 'last_day', 'retention_curve', 'share_link_create', 'share_link_list', 'share_link_revoke'],
  experiments: ['results'],
  prompts: ['list', 'get', 'create', 'update', 'delete', 'versions', 'restore'],
  publish_video: ['from_file', 'create_upload', 'complete_upload', 'publish_upload', 'publish_existing'],
};
const EXPECTED_TOOLS = Object.keys(ACTIONS).sort();

const LOCAL_ONLY: Record<string, string[]> = { publish_video: ['from_file'] };

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
  it.each(['stdio', 'http'] as const)('registers exactly the 10 intent tools on the %s server', async (transport) => {
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
    expect(Object.keys(tool?.inputSchema.properties ?? {}).length).toBeGreaterThan(1 + (actions.length === 0 ? 0 : 0));
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
    expect(remote.get('publish_video')?.description).not.toContain('from_file');
    const stdio = await listTools('stdio');
    expect(stdio.get('publish_video')?.description).toContain('from_file');
  });

  it('names the required fields of each action in the description, so a flat schema stays usable', async () => {
    const tools = await listTools('stdio');
    expect(tools.get('personas')?.description).toContain('create (');
    expect(tools.get('personas')?.description).toContain('delete (persona)');
    expect(tools.get('accounts')?.description).toContain('disconnect (account)');
  });

  it('keeps the whole tools/list payload at least 35% below the 102,160 bytes of the 56 endpoint-mirror tools', async () => {
    const tools = [...(await listTools('stdio')).values()];
    const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    expect(bytes).toBeLessThanOrEqual(102_160 * 0.65);
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
  const mockClient = {
    listPersonas: vi.fn(),
    listSocialAccounts: vi.fn(),
    listSchedules: vi.fn(),
    cancelSchedule: vi.fn(),
    getSlot: vi.fn(),
    updateSlotTitle: vi.fn(),
    deleteSlot: vi.fn(),
    disconnectAccount: vi.fn(),
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
    ['personas', { action: 'list' }, 'listPersonas', { personas: [] }],
    ['accounts', { action: 'list' }, 'listSocialAccounts', { accounts: [] }],
    ['accounts', { action: 'disconnect', account: 'did:plc:x', provider: 'bluesky' }, 'disconnectAccount', { success: true }],
    ['schedules', { action: 'list' }, 'listSchedules', { success: true, schedules: [] }],
    ['schedules', { action: 'cancel', scheduleId: 's1' }, 'cancelSchedule', { success: true, cancelledSlotIds: [] }],
    ['schedules', { action: 'get_slot', slotId: 's1' }, 'getSlot', {
      success: true,
      slot: {
        id: 's1', scheduleId: 'sched-1', slotAt: '2026-10-10T20:00:00Z', status: 'ready',
        title: 'T', error: null, publishedAt: null,
        postUrl: null, publishLinks: [], userNotices: [], providerFailures: [],
      },
      schedule: {
        id: 'sched-1', personaId: null, providers: [], youtubeAccountIds: [],
        instagramAccountIds: [], linkedinAccountIds: [], blueskyAccountIds: [],
        threadsAccountIds: [], facebookAccountIds: [], pinterestAccountIds: [],
        pinterestBoardId: null, threespeakAccountIds: [], rumbleAccountIds: [],
        fanvueAccountIds: [], telegramAccountIds: [], timezone: 'UTC', publishMode: 'scheduled',
      },
      persona: null,
    }],
    ['schedules', { action: 'update_slot_title', slotId: 's1', title: 'T' }, 'updateSlotTitle', { success: true, title: 'T' }],
    ['schedules', { action: 'delete_slot', slotId: 's1' }, 'deleteSlot', { success: true }],
  ];

  it.each(CASES)('%s %j calls %s', async (name, args, method, payload) => {
    if (name === 'accounts' && args.action === 'disconnect') {
      vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({ authenticated: true, accounts: [{ provider: 'bluesky', recordId: 'rec-1', did: 'did:plc:x', handle: 'a.bsky.social', connectedAt: 1700000000000, lastUsed: 1700000000000 }], message: 'ok' });
    }
    vi.mocked(mockClient[method] as ReturnType<typeof vi.fn>).mockResolvedValue(payload);
    const result = await call(name, args);
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(mockClient[method]).toHaveBeenCalled();
  });

  it('rejects a field of another action before any request is sent', async () => {
    const result = await call('personas', { action: 'list', name: 'Maria' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('personas · list');
    expect(mockClient.listPersonas).not.toHaveBeenCalled();
  });

  it('filters the accounts list by network', async () => {
    vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({
      authenticated: true,
      accounts: [
        { provider: 'youtube', recordId: 'rec-1', channelId: 'UC1', channelName: 'Maria', connectedAt: 1700000000000, lastUsed: 1700000000000 },
        { provider: 'bluesky', recordId: 'rec-2', did: 'd1', handle: 'b.bsky.social', connectedAt: 1700000000000, lastUsed: 1700000000000 },
      ],
      message: 'ok',
    });
    const result = await call('accounts', { action: 'list', provider: 'bluesky' });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text).accounts).toEqual([{ provider: 'bluesky', recordId: 'rec-2', did: 'd1', handle: 'b.bsky.social', connectedAt: 1700000000000, lastUsed: 1700000000000 }]);
  });
});
