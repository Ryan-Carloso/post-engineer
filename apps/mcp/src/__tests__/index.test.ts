import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer, isMainModule, requireApiKey } from '../index.js';
import {
  CreatePersonaSchema,
  CreatePersonaShape,
  ListPersonasShape,
  ListVoicesShape,
  ListFacesShape,
  UpdatePersonaShape,
  ListSocialAccountsShape,
  ConnectAccountShape,
  ListSchedulesShape,
  ListPostsShape,
  CancelScheduleShape,
  GetTokenBalanceShape,
  GeneratePersonaVideosShape,
  GetVideoStatusShape,
  GetVideoTaskProgressShape,
  ListPersonaImagesShape,
  AddPersonaImageShape,
  UpdatePersonaImageShape,
  RemovePersonaImageShape,
  GetSlotShape,
  UpdateSlotTopicShape,
  DeleteSlotShape,
  ListVideoGenerationsShape,
  GetVideoGenerationShape,
  ListTokenTransactionsShape,
  GetPersonaDeletePreviewShape,
  DeletePersonaShape,
  DisconnectAccountShape,
  PublishVideoDirectShape,
} from '../tools.js';
import type { PostEngineerClient } from '../client.js';

const mockTrackEvent = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

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
  'get_slot',
  'update_slot_topic',
  'delete_slot',
  'list_video_generations',
  'get_video_generation',
  'list_token_transactions',
  'get_persona_delete_preview',
  'delete_persona',
  'disconnect_account',
  'get_token_balance',
  'generate_persona_videos',
  'get_video_status',
  'get_video_task_progress',
  'list_persona_images',
  'add_persona_image',
  'update_persona_image',
  'remove_persona_image',
  'publish_video_direct',
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

describe('registered tool schemas (single source of truth)', () => {
  const mockClient = {} as unknown as PostEngineerClient;

  async function listServerTools(server: ReturnType<typeof createPostEngineerMcpServer>) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      return new Map(tools.map((t) => [t.name, t.inputSchema as { properties: Record<string, { maximum?: number; anyOf?: unknown[] }> }]));
    } finally {
      await client.close();
    }
  }

  it('registers every tool with its tools.ts shape fields (no registration drift)', async () => {
    const schemas = await listServerTools(createPostEngineerMcpServer(mockClient));
    const expected: Record<string, Record<string, unknown>> = {
      create_persona: CreatePersonaShape,
      list_personas: ListPersonasShape,
      list_voices: ListVoicesShape,
      list_faces: ListFacesShape,
      update_persona: UpdatePersonaShape,
      list_social_accounts: ListSocialAccountsShape,
      connect_account: ConnectAccountShape,
      list_schedules: ListSchedulesShape,
      list_posts: ListPostsShape,
      cancel_schedule: CancelScheduleShape,
      get_slot: GetSlotShape,
      update_slot_topic: UpdateSlotTopicShape,
      delete_slot: DeleteSlotShape,
      list_video_generations: ListVideoGenerationsShape,
      get_video_generation: GetVideoGenerationShape,
      list_token_transactions: ListTokenTransactionsShape,
      get_persona_delete_preview: GetPersonaDeletePreviewShape,
      delete_persona: DeletePersonaShape,
      disconnect_account: DisconnectAccountShape,
      get_token_balance: GetTokenBalanceShape,
      generate_persona_videos: GeneratePersonaVideosShape,
      get_video_status: GetVideoStatusShape,
      get_video_task_progress: GetVideoTaskProgressShape,
      list_persona_images: ListPersonaImagesShape,
      add_persona_image: AddPersonaImageShape,
      update_persona_image: UpdatePersonaImageShape,
      remove_persona_image: RemovePersonaImageShape,
      publish_video_direct: PublishVideoDirectShape,
    };
    expect(schemas.size).toBe(Object.keys(expected).length);
    for (const [name, shape] of Object.entries(expected)) {
      expect(Object.keys(schemas.get(name)?.properties ?? {}).sort()).toEqual(Object.keys(shape).sort());
    }
  });

  it('registers create_persona with the tools.ts schema (paragraphNumber max 10)', async () => {
    const schemas = await listServerTools(createPostEngineerMcpServer(mockClient));
    // CreatePersonaSchema wraps the raw shape in .superRefine() for the
    // images-require-avatarUrl rule, so it is a ZodEffects: unwrap to the
    // inner object to reach the registered field list.
    const inner =
      CreatePersonaSchema instanceof z.ZodEffects
        ? CreatePersonaSchema.innerType()
        : CreatePersonaSchema;
    expect(Object.keys(schemas.get('create_persona')?.properties ?? {}).sort()).toEqual(
      Object.keys((inner as z.AnyZodObject).shape).sort()
    );
    expect(schemas.get('create_persona')?.properties.paragraphNumber?.maximum).toBe(10);
  });

  it('registers update_persona without a nullable avatarUrl', async () => {
    const schemas = await listServerTools(createPostEngineerMcpServer(mockClient));
    const avatarUrl = schemas.get('update_persona')?.properties.avatarUrl;
    expect(avatarUrl?.anyOf).toBeUndefined();
  });
});

describe('withTracking wrapper', () => {
  // Every tool call must emit mcp_tool_called with the tool name AND still
  // run the real handler. Pin both: dropping the trackEvent call or
  // swallowing the handler result are the Stryker survivors here.
  const mockClient = {
    listVoices: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    mockTrackEvent.mockClear();
    vi.mocked(mockClient.listVoices).mockReset();
  });

  it('tracks the tool call and returns the handler result', async () => {
    vi.mocked(mockClient.listVoices).mockResolvedValue([{ id: 'alloy' }]);
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: 'list_voices', arguments: {} });
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'mcp_tool_called',
        expect.objectContaining({ toolName: 'list_voices' })
      );
      expect(mockClient.listVoices).toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)?.[0]?.text ?? '';
      expect(text).toContain('alloy');
    } finally {
      await client.close();
    }
  });

  it('still tracks when the handler throws', async () => {
    vi.mocked(mockClient.listVoices).mockRejectedValue(new Error('down'));
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: 'list_voices', arguments: {} });
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'mcp_tool_called',
        expect.objectContaining({ toolName: 'list_voices' })
      );
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('new tool registrations run their handlers', () => {
  // The registration lambdas in createPostEngineerMcpServer only execute
  // when the tool is actually called: drive each of the nine new tools
  // through the in-memory transport so the wrappers stay covered.
  const mockClient = {
    getSlot: vi.fn(),
    updateSlotTopic: vi.fn(),
    deleteSlot: vi.fn(),
    listVideoGenerations: vi.fn(),
    getVideoGeneration: vi.fn(),
    listTokenTransactions: vi.fn(),
    getPersonaDeletePreview: vi.fn(),
    deletePersona: vi.fn(),
    disconnectAccount: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    mockTrackEvent.mockClear();
    vi.clearAllMocks();
  });

  async function callNewTool(
    toolName: string,
    args: Record<string, unknown>,
    clientMethod: ReturnType<typeof vi.fn>,
    payload: unknown
  ) {
    clientMethod.mockResolvedValue(payload);
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      expect(result.isError).toBeFalsy();
      expect(clientMethod).toHaveBeenCalled();
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'mcp_tool_called',
        expect.objectContaining({ toolName })
      );
    } finally {
      await client.close();
    }
  }

  it('calls through get_slot', async () => {
    await callNewTool('get_slot', { slotId: 's1' }, vi.mocked(mockClient.getSlot), {
      slot: { id: 's1' },
    });
  });

  it('calls through update_slot_topic', async () => {
    await callNewTool(
      'update_slot_topic',
      { slotId: 's1', topic: 'T' },
      vi.mocked(mockClient.updateSlotTopic),
      { topic: 'T' }
    );
  });

  it('calls through delete_slot', async () => {
    await callNewTool('delete_slot', { slotId: 's1' }, vi.mocked(mockClient.deleteSlot), {
      success: true,
    });
  });

  it('calls through list_video_generations', async () => {
    await callNewTool(
      'list_video_generations',
      {},
      vi.mocked(mockClient.listVideoGenerations),
      { generations: [] }
    );
  });

  it('calls through get_video_generation', async () => {
    await callNewTool(
      'get_video_generation',
      { generationId: 'g1' },
      vi.mocked(mockClient.getVideoGeneration),
      { generation: { generationId: 'g1' } }
    );
  });

  it('calls through list_token_transactions', async () => {
    await callNewTool(
      'list_token_transactions',
      {},
      vi.mocked(mockClient.listTokenTransactions),
      { transactions: [], total: 0 }
    );
  });

  it('calls through get_persona_delete_preview', async () => {
    await callNewTool(
      'get_persona_delete_preview',
      { personaId: 'p1' },
      vi.mocked(mockClient.getPersonaDeletePreview),
      { persona: { id: 'p1', name: 'Ava' }, counts: {}, videos: [] }
    );
  });

  it('calls through delete_persona', async () => {
    await callNewTool(
      'delete_persona',
      { personaId: 'p1' },
      vi.mocked(mockClient.deletePersona),
      { success: true }
    );
  });

  it('calls through disconnect_account', async () => {
    await callNewTool(
      'disconnect_account',
      { provider: 'bluesky', providerAccountId: 'did:plc:x' },
      vi.mocked(mockClient.disconnectAccount),
      { success: true }
    );
  });
});
