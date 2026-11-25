import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import { SERVER_INSTRUCTIONS } from '../server-instructions.js';

type Transport = 'stdio' | 'http';

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
});
