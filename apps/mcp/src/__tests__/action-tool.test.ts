import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mcpTelemetryHeaders } from '../analytics.js';
import { actionDescription, actionShape, byAction } from '../action-tool.js';
import type { McpToolResponse } from '../tools-call.js';

// Issue #566: one tool, many actions. The tools/list schema is one flat
// object (a root union advertises no fields), and a strict per-action schema
// re-parses the arguments inside the handler so a wrong-branch field fails
// loudly, naming the action and the field.

const SPECS = {
  list: { limit: z.number().int().min(1).max(10).optional().describe('Max rows.') },
  create: { name: z.string().min(1).describe('Display name.'), limit: z.number().int().min(1).max(10).optional().describe('Max rows.') },
  remove: { id: z.string().min(1).describe('Row id.') },
} satisfies Record<string, z.ZodRawShape>;

function text(response: McpToolResponse): string {
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

function handlers(seen: Array<{ action: string; args: unknown; tool: string | null }>) {
  const note = (action: string) => async (args: unknown): Promise<McpToolResponse> => {
    seen.push({ action, args, tool: mcpTelemetryHeaders({ includeVersion: false })['X-MCP-Tool'] ?? null });
    return { content: [{ type: 'text', text: `${action} ok` }] };
  };
  return { list: note('list'), create: note('create'), remove: note('remove') };
}

describe('actionShape', () => {
  const shape = actionShape(SPECS);

  it('is one flat object: a required action enum plus every field of every action, optional', () => {
    expect(Object.keys(shape).sort()).toEqual(['action', 'id', 'limit', 'name']);
    expect(shape.action.safeParse('list').success).toBe(true);
    expect(shape.action.safeParse('nope').success).toBe(false);
    expect(shape.action.safeParse(undefined).success).toBe(false);
    for (const field of ['id', 'limit', 'name']) expect(shape[field].safeParse(undefined).success).toBe(true);
  });

  it('keeps a field shared by several actions once, with its first description', () => {
    const json = z.toJSONSchema(z.object(shape));
    expect(JSON.stringify(json)).toContain('Max rows.');
    expect(Object.keys((json as { properties: object }).properties)).toHaveLength(4);
  });

  it('is advertised by tools/list with every field, not an empty object', async () => {
    const server = new McpServer({ name: 't', version: '0.0.0' });
    server.tool('things', 'd', shape, byAction(handlers([]), SPECS, 'things'));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'c', version: '0.0.0' });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(Object.keys((tools[0].inputSchema.properties ?? {}) as object).sort()).toEqual(['action', 'id', 'limit', 'name']);
    expect(tools[0].inputSchema.required).toEqual(['action']);
  });
});

describe('actionDescription', () => {
  it('appends the required fields of each action so the agent can tell them apart in a flat schema', () => {
    const description = actionDescription('Manage things.', SPECS);
    expect(description).toContain('Manage things.');
    expect(description).toContain('list (no required fields)');
    expect(description).toContain('create (name)');
    expect(description).toContain('remove (id)');
  });
});

describe('byAction', () => {
  it('rejects a handler set that does not match the action specs, so a typo cannot ship', () => {
    expect(() => byAction({ list: async () => ({ content: [] }) }, SPECS as never, 'things')).toThrow(/create, remove/);
    expect(() => byAction({ ...handlers([]), extra: async () => ({ content: [] }) } as never, SPECS, 'things')).toThrow(/extra/);
  });

  it('runs the handler of the chosen action with the parsed fields, inside a tracked call that names tool and action', async () => {
    const seen: Array<{ action: string; args: unknown; tool: string | null }> = [];
    const run = byAction(handlers(seen), SPECS, 'things');
    const response = await run({ action: 'create', name: 'Maria' });
    expect(text(response)).toBe('create ok');
    expect(seen).toEqual([{ action: 'create', args: { name: 'Maria' }, tool: 'things' }]);
  });

  it('names the action in the telemetry headers of the requests it sends', async () => {
    let action: string | undefined;
    const run = byAction(
      { list: async () => { action = mcpTelemetryHeaders({ includeVersion: false })['X-MCP-Action']; return { content: [] }; }, create: async () => ({ content: [] }), remove: async () => ({ content: [] }) },
      SPECS,
      'things',
    );
    await run({ action: 'list' });
    expect(action).toBe('list');
  });

  it('rejects a field that belongs to another action, naming the action and the field', async () => {
    const seen: Array<{ action: string; args: unknown; tool: string | null }> = [];
    const response = await byAction(handlers(seen), SPECS, 'things')({ action: 'list', name: 'Maria' });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('things · list');
    expect(text(response)).toContain('name');
    expect(seen).toEqual([]);
  });

  it('rejects a missing required field of the chosen action, naming it', async () => {
    const response = await byAction(handlers([]), SPECS, 'things')({ action: 'create' });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('things · create');
    expect(text(response)).toContain('name');
  });

  it('applies the per-action limits, not just the advertised flat field', async () => {
    const response = await byAction(handlers([]), SPECS, 'things')({ action: 'list', limit: 99 });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('limit');
  });

  it('rejects an unknown action without calling any handler', async () => {
    const seen: Array<{ action: string; args: unknown; tool: string | null }> = [];
    const response = await byAction(handlers(seen), SPECS, 'things')({ action: 'explode' });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('explode');
    expect(text(response)).toContain('list, create, remove');
    expect(seen).toEqual([]);
  });

  it('works end to end through a real MCP client: a wrong-branch call is an isError result, not a protocol error', async () => {
    const server = new McpServer({ name: 't', version: '0.0.0' });
    server.tool('things', 'd', actionShape(SPECS), byAction(handlers([]), SPECS, 'things'));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'c', version: '0.0.0' });
    await client.connect(b);
    const ok = await client.callTool({ name: 'things', arguments: { action: 'remove', id: 'x' } });
    expect(ok.isError).not.toBe(true);
    const wrong = await client.callTool({ name: 'things', arguments: { action: 'remove', name: 'x' } });
    expect(wrong.isError).toBe(true);
  });
});
