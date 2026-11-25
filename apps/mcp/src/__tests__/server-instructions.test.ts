import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import {
  POINTER_HISTORY,
  POINTER_IMAGES,
  POINTER_PERSONA_ACCOUNTS,
  POINTER_POSTS_SCHEDULES,
  ROUTING_LIFECYCLE,
  SERVER_INSTRUCTIONS,
} from '../server-instructions.js';

type Transport = 'stdio' | 'http';

const LIFECYCLE_TOOLS = ['generate_video', 'publish_video', 'video_tasks', 'schedules', 'posts', 'insights', 'experiments', 'check_script'];

const ACTION_REFERENCE = /`?([a-z_]+) \(action: ([a-z_]+)\)/g;

interface Connected {
  instructions: string | undefined;
  tools: Map<string, Tool>;
}

async function connect(transport: Transport): Promise<Connected> {
  const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  try {
    const { tools } = await mcp.listTools();
    return { instructions: mcp.getInstructions(), tools: new Map(tools.map((tool) => [tool.name, tool])) };
  } finally {
    await mcp.close();
  }
}

function actionsOf(tool: Tool | undefined): string[] {
  const action = (tool?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.action;
  return action?.enum ?? [];
}

function actionReferences(text: string): Array<{ tool: string; action: string }> {
  return [...text.matchAll(ACTION_REFERENCE)].map((match) => ({ tool: match[1] ?? '', action: match[2] ?? '' }));
}

describe.each(['stdio', 'http'] as const)('server instructions on the %s server', (transport) => {
  it('hands the client exactly SERVER_INSTRUCTIONS at initialize', async () => {
    const { instructions } = await connect(transport);
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
  });

  it('only references tool actions that the tool really offers', async () => {
    const { tools } = await connect(transport);
    const references = actionReferences(SERVER_INSTRUCTIONS);
    expect(references.length).toBeGreaterThan(0);
    for (const { tool, action } of references) {
      expect(actionsOf(tools.get(tool)), `${tool} (action: ${action})`).toContain(action);
    }
  });

  it('names every job tool of the lifecycle, and each is a registered tool', async () => {
    const { tools } = await connect(transport);
    for (const name of LIFECYCLE_TOOLS) {
      expect(tools.has(name), `${name} is registered`).toBe(true);
      expect(ROUTING_LIFECYCLE.includes(name), `${name} is in the lifecycle line`).toBe(true);
    }
  });

  it('answers where a scheduled post vs a slot lives', () => {
    expect(SERVER_INSTRUCTIONS).toContain(POINTER_POSTS_SCHEDULES);
    expect(POINTER_POSTS_SCHEDULES).toContain('use posts');
    expect(POINTER_POSTS_SCHEDULES).toContain('use schedules');
  });

  it('answers where to rebind persona accounts', () => {
    expect(SERVER_INSTRUCTIONS).toContain(POINTER_PERSONA_ACCOUNTS);
    expect(POINTER_PERSONA_ACCOUNTS).toContain('accounts (action: set_persona_publishing)');
  });

  it('answers persona image vs segment image', () => {
    expect(SERVER_INSTRUCTIONS).toContain(POINTER_IMAGES);
    expect(POINTER_IMAGES).toContain('persona_media');
    expect(POINTER_IMAGES).toContain('media (action: upload)');
  });

  it('answers where generation history vs post status lives', () => {
    expect(SERVER_INSTRUCTIONS).toContain(POINTER_HISTORY);
  });
});
