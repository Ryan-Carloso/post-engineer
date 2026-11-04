import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InitializeResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SERVER_INSTRUCTIONS,
  ListPromptsShape,
  GetPromptShape,
  handleListPrompts,
  handleGetPrompt,
} from '../tools-prompts.js';
import { HUB_PROMPTS } from '../prompts.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';

//---------------
// Recipe self-serve tools: list_prompts and get_prompt mirror the hub's
// slugs exactly (they wrap HUB_PROMPTS), keep the prompt text out of the
// list payload, and reject unknown slugs the way the repo rejects unknown
// ids: an explicit error naming the valid values.
//---------------

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first !== undefined && first.type === 'text' ? first.text : '';
}

describe('handleListPrompts', () => {
  it('returns every hub prompt as slug + title + description, in hub order', async () => {
    const result = await handleListPrompts();
    expect(result.isError).toBeFalsy();
    const listed = JSON.parse(textOf(result)) as Array<{ slug: string; title: string; description: string }>;
    expect(listed.map((entry) => entry.slug)).toEqual(HUB_PROMPTS.map((prompt) => prompt.slug));
    for (let i = 0; i < HUB_PROMPTS.length; i += 1) {
      expect(listed[i]?.title).toBe(HUB_PROMPTS[i]?.title);
      expect(listed[i]?.description).toBe(HUB_PROMPTS[i]?.description);
    }
  });

  it('keeps the full prompt texts out of the list payload (token-cheap discovery)', async () => {
    const result = await handleListPrompts();
    for (const prompt of HUB_PROMPTS) {
      expect(textOf(result)).not.toContain(prompt.prompt);
    }
  });

  it('registers both tools as zero-config shapes a caller can validate locally', () => {
    // list_prompts takes no arguments; get_prompt takes exactly one. Both
    // shapes stay argument-only: no ambient state, no client in the shape.
    expect(ListPromptsShape).toEqual({});
    expect(Object.keys(GetPromptShape)).toEqual(['slug']);
  });
});

describe('handleGetPrompt', () => {
  for (const prompt of HUB_PROMPTS) {
    it(`returns the exact hub prompt text for slug '${prompt.slug}'`, async () => {
      const result = await handleGetPrompt({ slug: prompt.slug });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toBe(prompt.prompt);
    });
  }

  it('rejects an unknown slug with an explicit error naming the valid slugs', async () => {
    const result = await handleGetPrompt({ slug: 'car-review' });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("unknown prompt slug \"car-review\"");
    for (const prompt of HUB_PROMPTS) {
      expect(text).toContain(prompt.slug);
    }
  });

  it('rejects a missing slug instead of reading a file or guessing', async () => {
    const result = await handleGetPrompt({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('unknown prompt slug');
  });

  it('describes the shape with the valid slugs even before the call', () => {
    const description = GetPromptShape.slug.description ?? '';
    for (const prompt of HUB_PROMPTS) {
      expect(description).toContain(prompt.slug);
    }
    expect(description).toContain('list_prompts');
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  it('points topic-shaped requests at list_prompts before any scripting', () => {
    expect(SERVER_INSTRUCTIONS).toContain('call list_prompts first');
    expect(SERVER_INSTRUCTIONS).toContain('get_prompt');
    expect(SERVER_INSTRUCTIONS).toContain('instead of improvising the script');
  });
});

describe('registerPromptTools', () => {
  // Drive the registered tools through the in-memory transport so every
  // registration wrapper (tracking included) actually runs.
  const mockClient = {} as unknown as PostEngineerClient;

  async function withClient(run: (client: Client) => Promise<void>): Promise<void> {
    const server = createPostEngineerMcpServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await run(client);
    } finally {
      await client.close();
    }
  }

  it('registers list_prompts zero-arg and get_prompt with a required slug', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const listPrompts = tools.find((tool) => tool.name === 'list_prompts');
      const getPrompt = tools.find((tool) => tool.name === 'get_prompt');
      expect(listPrompts).toBeDefined();
      expect(getPrompt).toBeDefined();
      expect(Object.keys(listPrompts?.inputSchema.properties ?? {})).toEqual([]);
      expect(Object.keys(getPrompt?.inputSchema.properties ?? {})).toEqual(['slug']);
      expect(getPrompt?.inputSchema.required).toEqual(['slug']);
    });
  });

  it('runs list_prompts end to end through the transport', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'list_prompts', arguments: {} });
      expect(result.isError).toBeFalsy();
      const listed = JSON.parse(textOf(result)) as Array<{ slug: string }>;
      expect(listed.map((entry) => entry.slug)).toEqual(HUB_PROMPTS.map((prompt) => prompt.slug));
    });
  });

  it('runs get_prompt end to end for a known slug through the transport', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'get_prompt', arguments: { slug: 'daily-news' } });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toBe(
        HUB_PROMPTS.find((prompt) => prompt.slug === 'daily-news')?.prompt,
      );
    });
  });

  it('runs get_prompt end to end for an unknown slug as a tool error', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'get_prompt', arguments: { slug: 'nope' } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('nope');
    });
  });

  it('keeps generate_persona_video pointing topic-shaped requests back at the recipes', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const generate = tools.find((tool) => tool.name === 'generate_persona_video');
      expect(generate?.description).toContain('call list_prompts first');
      expect(generate?.description).toContain('get_prompt');
    });
  });

  it('advertises server instructions that mention the recipe discovery path', async () => {
    await withClient(async (client) => {
      // The high-level client drops instructions when it caches only
      // serverInfo, so run a second, raw initialize handshake and read the
      // wire answer itself.
      const result = await client.request(
        {
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '0.0.0' },
          },
        },
        InitializeResultSchema,
      );
      expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
    });
  });
});
