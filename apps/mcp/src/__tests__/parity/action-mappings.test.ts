import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callToolRecordingRequests, requestReaches } from './behaviour.js';
import { buildMcpCallGraph } from './mcp-calls.js';
import { EndpointMappingSchema, endpointToolNames, uncoveredEndpoints, verifyMapping } from './mappings.js';

// Parity gate v2 (issue #566, §6): an endpoint maps to `{ tool, action? }`,
// and the gate proves that the named action's handler reaches the endpoint.
// Every test below is a negative control — a mapping that claims coverage it
// does not have — plus the accepted shapes that keep the gate usable.

const SOURCES = [
  {
    file: 'client.ts',
    text: `
      export class Client {
        async listPersonas() { return this.request('/api/persona/list', { method: 'GET' }, 'list'); }
        async createPersona() { return this.request('/api/persona', { method: 'POST' }, 'create'); }
        async deletePersona() { return this.request('/api/persona', { method: 'DELETE' }, 'delete'); }
        async getBalance() { return this.request('/api/billing/tokens', { method: 'GET' }, 'balance'); }
      }
    `,
  },
  {
    file: 'persona-tools.ts',
    text: `
      async function handleList(client: Client) { return client.listPersonas(); }
      async function handleCreate(client: Client) { return client.createPersona(); }
      server.tool('personas', 'd', {}, MUTATING, byAction({
        list: handleList,
        create: handleCreate,
        remove: async (client: Client) => client.deletePersona(),
      }));
      server.tool('get_token_balance', 'd', {}, READ_ONLY, async () => client.getBalance());
    `,
  },
];
const graph = buildMcpCallGraph(SOURCES);

describe('parity gate v2: action discovery', () => {
  it('reads the actions of a byAction registration: function names, inline arrows and their request sites', () => {
    expect([...(graph.toolActions.get('personas')?.keys() ?? [])].sort()).toEqual(['create', 'list', 'remove']);
    expect(graph.toolActions.get('personas')?.get('list')).toEqual([{ method: 'GET', path: '/api/persona/list' }]);
    expect(graph.toolActions.get('personas')?.get('remove')).toEqual([{ method: 'DELETE', path: '/api/persona' }]);
  });

  it('gives the tool the union of its actions’ request sites', () => {
    expect(graph.toolSites.get('personas')).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/api/persona/list' },
        { method: 'POST', path: '/api/persona' },
        { method: 'DELETE', path: '/api/persona' },
      ]),
    );
  });

  it('leaves a plain tool without actions', () => {
    expect(graph.toolActions.has('get_token_balance')).toBe(false);
    expect(graph.tools).toContain('get_token_balance');
  });
});

describe('parity gate v2: mapping format', () => {
  it('accepts { tool } and { tool, action }', () => {
    expect(() =>
      EndpointMappingSchema.parse({ 'GET /api/billing/tokens': [{ tool: 'get_token_balance' }], 'GET /api/persona/list': [{ tool: 'personas', action: 'list' }] }),
    ).not.toThrow();
  });

  it('rejects the old string format, unknown fields, empty tool lists and empty names', () => {
    expect(() => EndpointMappingSchema.parse({ 'GET /api/x': ['get_token_balance'] })).toThrow();
    expect(() => EndpointMappingSchema.parse({ 'GET /api/x': [{ tool: 'a', actions: ['b'] }] })).toThrow();
    expect(() => EndpointMappingSchema.parse({ 'GET /api/x': [] })).toThrow();
    expect(() => EndpointMappingSchema.parse({ 'GET /api/x': [{ tool: '' }] })).toThrow();
    expect(() => EndpointMappingSchema.parse({ 'GET /api/x': [{ tool: 'a', action: '' }] })).toThrow();
  });

  it('lists the distinct tool names behind each endpoint', () => {
    expect(
      endpointToolNames({
        'GET /api/persona/list': [{ tool: 'personas', action: 'list' }, { tool: 'list_personas' }],
        'POST /api/persona': [{ tool: 'personas', action: 'create' }, { tool: 'personas', action: 'create' }],
      }),
    ).toEqual({ 'GET /api/persona/list': ['personas', 'list_personas'], 'POST /api/persona': ['personas'] });
  });
});

describe('parity gate v2: mappings are proven, not labelled', () => {
  it('accepts an action whose handler reaches the endpoint, and a plain tool that does', () => {
    expect(verifyMapping('GET /api/persona/list', [{ tool: 'personas', action: 'list' }], graph)).toEqual([]);
    expect(verifyMapping('DELETE /api/persona', [{ tool: 'personas', action: 'remove' }], graph)).toEqual([]);
    expect(verifyMapping('GET /api/billing/tokens', [{ tool: 'get_token_balance' }], graph)).toEqual([]);
  });

  it('rejects a mapping to a tool that is not registered', () => {
    expect(verifyMapping('GET /api/persona/list', [{ tool: 'ghost', action: 'list' }], graph)).toContainEqual(
      expect.stringContaining('not registered'),
    );
  });

  it('rejects a mapping to an action the tool does not have', () => {
    expect(verifyMapping('GET /api/persona/list', [{ tool: 'personas', action: 'enumerate' }], graph)).toContainEqual(
      expect.stringContaining('no action "enumerate"'),
    );
  });

  it('rejects an action whose handler does not reach the endpoint, even if a sibling action does', () => {
    // `create` reaches POST /api/persona; DELETE /api/persona is reached only by `remove`.
    const errors = verifyMapping('DELETE /api/persona', [{ tool: 'personas', action: 'create' }], graph);
    expect(errors).toContainEqual(expect.stringContaining('action "create" never calls DELETE /api/persona'));
  });

  it('rejects mapping the whole of an action tool: the action is what is proven', () => {
    expect(verifyMapping('GET /api/persona/list', [{ tool: 'personas' }], graph)).toContainEqual(
      expect.stringContaining('map { tool, action }'),
    );
  });

  it('rejects an action named on a tool that has no actions', () => {
    expect(verifyMapping('GET /api/billing/tokens', [{ tool: 'get_token_balance', action: 'balance' }], graph)).toContainEqual(
      expect.stringContaining('has no actions'),
    );
  });

  it('rejects a plain tool that never calls the endpoint', () => {
    expect(verifyMapping('GET /api/persona/list', [{ tool: 'get_token_balance' }], graph)).toContainEqual(
      expect.stringContaining('never calls GET /api/persona/list'),
    );
  });

  it('rejects the same { tool, action } listed twice for one endpoint', () => {
    expect(
      verifyMapping('GET /api/persona/list', [{ tool: 'personas', action: 'list' }, { tool: 'personas', action: 'list' }], graph),
    ).toContainEqual(expect.stringContaining('listed twice'));
  });

  it('fails once the only action that reaches an endpoint is removed from the source', () => {
    const without = buildMcpCallGraph([
      SOURCES[0],
      { file: 'persona-tools.ts', text: SOURCES[1].text.replace(/\n\s*remove: async[^\n]*/, '') },
    ]);
    expect(without.toolActions.get('personas')?.has('remove')).toBe(false);
    expect(verifyMapping('DELETE /api/persona', [{ tool: 'personas', action: 'remove' }], graph)).toEqual([]);
    expect(verifyMapping('DELETE /api/persona', [{ tool: 'personas', action: 'remove' }], without)).toContainEqual(
      expect.stringContaining('no action "remove"'),
    );
  });
});

describe('parity gate v2: coverage stays total', () => {
  it('reports a discovered endpoint with neither a mapping nor an exclusion', () => {
    expect(
      uncoveredEndpoints(['GET /api/a', 'GET /api/b', 'GET /api/c'], { 'GET /api/a': [{ tool: 'x' }] }, { 'GET /api/c': {} }),
    ).toEqual(['GET /api/b']);
  });

  it('reports nothing when every endpoint is mapped or excluded', () => {
    expect(uncoveredEndpoints(['GET /api/a', 'GET /api/c'], { 'GET /api/a': [{ tool: 'x' }] }, { 'GET /api/c': {} })).toEqual([]);
  });
});

describe('parity gate v2: behavioural proof', () => {
  function demoServer(issue: boolean): McpServer {
    const server = new McpServer({ name: 'demo', version: '0.0.0' });
    server.tool('demo', 'd', { action: z.enum(['list', 'noop']) }, async (args) => {
      if (args.action === 'list' && issue) {
        await fetch('https://example.test/api/persona/video-status/task-1?x=1', { method: 'GET' });
      }
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });
    return server;
  }

  it('records the HTTP request an invoked action really sends', async () => {
    const recorded = await callToolRecordingRequests(demoServer(true), 'demo', { action: 'list' });
    expect(recorded).toEqual([{ method: 'GET', pathname: '/api/persona/video-status/task-1' }]);
    expect(requestReaches(recorded, 'GET /api/persona/video-status/[taskId]')).toBe(true);
  });

  it('does not accept a request with another method or path', async () => {
    const recorded = await callToolRecordingRequests(demoServer(true), 'demo', { action: 'list' });
    expect(requestReaches(recorded, 'POST /api/persona/video-status/[taskId]')).toBe(false);
    expect(requestReaches(recorded, 'GET /api/persona/video-status')).toBe(false);
    expect(requestReaches(recorded, 'GET /api/persona/list')).toBe(false);
  });

  it('records nothing when the action sends no request, so a label cannot pass', async () => {
    const recorded = await callToolRecordingRequests(demoServer(false), 'demo', { action: 'list' });
    expect(recorded).toEqual([]);
    expect(requestReaches(recorded, 'GET /api/persona/video-status/[taskId]')).toBe(false);
  });

  it('restores the global fetch after a call, also when the tool throws', async () => {
    const original = globalThis.fetch;
    const server = new McpServer({ name: 'demo', version: '0.0.0' });
    server.tool('boom', 'd', {}, async () => {
      throw new Error('boom');
    });
    await callToolRecordingRequests(server, 'boom', {});
    expect(globalThis.fetch).toBe(original);
  });

  it('rejects an unknown tool instead of recording an empty list', async () => {
    await expect(callToolRecordingRequests(demoServer(true), 'missing', {})).rejects.toThrow(/missing/);
  });
});
