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
  TESTING_FOLLOW_UPS,
  TESTING_KNOBS,
  TESTING_PROMPT_FLOW,
  TESTING_SAMPLE_RULES,
  TESTING_WHEN,
} from '../server-instructions.js';

type Transport = 'stdio' | 'http';

const POINTER_DESCRIPTION_TOOLS = ['personas', 'persona_media', 'posts', 'schedules'];

const LIFECYCLE_TOOLS = ['publish_video', 'schedules', 'posts', 'insights', 'experiments'];

const ACTION_REFERENCE = /([a-z_]+) \(action: ([a-z_]+)\)/g;

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function actionsOf(tool: Tool | undefined): string[] {
  const properties = tool?.inputSchema.properties;
  if (typeof properties !== 'object' || properties === null) return [];
  if (!('action' in properties)) return [];
  const action = properties.action;
  if (typeof action !== 'object' || action === null || !('enum' in action)) return [];
  return isStringArray(action.enum) ? action.enum : [];
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
      const clause = `; ${name} `;
      const firstClause = `: ${name} `;
      expect(ROUTING_LIFECYCLE.includes(clause) || ROUTING_LIFECYCLE.includes(firstClause), `${name} has its own lifecycle clause`).toBe(true);
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

  it('answers where the persona photo and identity card live', () => {
    expect(SERVER_INSTRUCTIONS).toContain(POINTER_IMAGES);
    expect(POINTER_IMAGES).toContain('persona_media');
    expect(POINTER_IMAGES).toContain('personas (action: create or update)');
  });

  it('answers where post status lives', () => {
    expect(SERVER_INSTRUCTIONS).toContain(POINTER_HISTORY);
    expect(SERVER_INSTRUCTIONS).toContain('posts (action: list)');
  });

  it('says that generation is gone and that the closed beta gates publishing', () => {
    expect(SERVER_INSTRUCTIONS).toContain('It does not generate video');
    expect(SERVER_INSTRUCTIONS).toContain('BETA_ACCESS_REQUIRED');
  });

  describe('prompt test flow', () => {
    it('routes a test to the versions → promptVersionId → results flow', () => {
      const get = TESTING_PROMPT_FLOW.indexOf('prompts (action: get)');
      const pass = TESTING_PROMPT_FLOW.indexOf('promptVersionId');
      const read = TESTING_PROMPT_FLOW.indexOf('experiments (action: results)');
      expect(SERVER_INSTRUCTIONS).toContain(TESTING_PROMPT_FLOW);
      expect(get).toBeGreaterThan(-1);
      expect(pass).toBeGreaterThan(get);
      expect(read).toBeGreaterThan(pass);
    });

    it('does not route to an experiments create action', () => {
      expect(SERVER_INSTRUCTIONS).not.toContain('experiments (action: create)');
      expect(SERVER_INSTRUCTIONS).not.toContain('create an experiment');
    });
  });

  it('states the sample-size rules', () => {
    expect(TESTING_SAMPLE_RULES).toContain('at least 10');
    expect(TESTING_SAMPLE_RULES).toContain('fewer than 5');
    expect(TESTING_SAMPLE_RULES).toContain('only when results labels it clear');
    expect(SERVER_INSTRUCTIONS).toContain(TESTING_SAMPLE_RULES);
  });

  it('recommends a test only for comparative requests', () => {
    expect(SERVER_INSTRUCTIONS).toContain(TESTING_WHEN);
    expect(TESTING_WHEN).toContain('"which is better"');
    expect(TESTING_WHEN).toContain('just publish it');
  });

  it('points other comparisons at post_metrics', () => {
    expect(SERVER_INSTRUCTIONS).toContain(TESTING_KNOBS);
    expect(TESTING_KNOBS).toContain('insights (action: post_metrics)');
  });

  it('explains the no prompt baseline group', () => {
    expect(TESTING_KNOBS).toContain('"no prompt" baseline');
  });

  it('answers the follow-up questions after a test', () => {
    expect(SERVER_INSTRUCTIONS).toContain(TESTING_FOLLOW_UPS);
    expect(TESTING_FOLLOW_UPS).toContain('prompts (action: restore)');
  });

  it('points the persona tool at accounts for rebinding publishing accounts', async () => {
    const { tools } = await connect(transport);
    expect(tools.get('personas')?.description).toContain(POINTER_PERSONA_ACCOUNTS);
    expect(tools.get('personas')?.description).toContain('accounts (action: set_persona_publishing)');
  });

  it('points persona_media at the photo pointer', async () => {
    const { tools } = await connect(transport);
    expect(tools.get('persona_media')?.description).toContain(POINTER_IMAGES);
  });

  it('points posts and schedules at the read vs change split', async () => {
    const { tools } = await connect(transport);
    expect(tools.get('posts')?.description).toContain(POINTER_POSTS_SCHEDULES);
    expect(tools.get('schedules')?.description).toContain(POINTER_POSTS_SCHEDULES);
  });

  it('only references tool actions that exist in the pointer-bearing tool descriptions', async () => {
    const { tools } = await connect(transport);
    let checked = 0;
    for (const name of POINTER_DESCRIPTION_TOOLS) {
      for (const { tool, action } of actionReferences(tools.get(name)?.description ?? '')) {
        expect(actionsOf(tools.get(tool)), `${name}: ${tool} (action: ${action})`).toContain(action);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
