import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPostEngineerMcpServer } from '../index.js';
import { serveHttpTransport, type HttpTransportHandle } from '../http-transport.js';
import type { PostEngineerClient } from '../client.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

// ChatGPT and other annotation-aware clients use these hints to decide
// whether to auto-approve, confirm, or warn. Every tool must carry them, and
// they are per TOOL, not per action: a tool with a destructive action is
// annotated destructive for all its actions (the most dangerous action wins,
// issue #566 §12), so only the domains with no destructive action are
// read-only, and cancel_video stays its own tool so a client can allow status
// checks without allowing cancellation.
const READ_ONLY_TOOLS = ['video_tasks', 'posts', 'insights', 'billing', 'prompts', 'check_script'];

const DESTRUCTIVE_TOOLS = ['cancel_video', 'personas', 'persona_media', 'voices', 'accounts', 'schedules', 'publish_video'];

const MUTATING_TOOLS = ['generate_video', 'experiments', 'media'];

describe('tool annotations over HTTP tools/list', () => {
  it('carries readOnly/destructive/openWorld hints for every tool', async () => {
    const handle: HttpTransportHandle = await serveHttpTransport(
      () => createPostEngineerMcpServer({} as unknown as PostEngineerClient, 'http'),
      { host: '127.0.0.1', port: 0, allowRemote: false },
    );
    try {
      const client = new Client({ name: 'annotations-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
      try {
        const { tools } = await client.listTools();
        const byName = new Map(tools.map((t) => [t.name, t.annotations]));
        expect([...byName.keys()].sort()).toEqual([...READ_ONLY_TOOLS, ...DESTRUCTIVE_TOOLS, ...MUTATING_TOOLS].sort());
        for (const name of READ_ONLY_TOOLS) {
          expect(byName.get(name), `tool ${name}`).toMatchObject({
            readOnlyHint: true,
            destructiveHint: false,
          });
        }
        for (const name of DESTRUCTIVE_TOOLS) {
          expect(byName.get(name), `tool ${name}`).toMatchObject({
            readOnlyHint: false,
            destructiveHint: true,
          });
        }
        for (const name of MUTATING_TOOLS) {
          expect(byName.get(name), `tool ${name}`).toMatchObject({
            readOnlyHint: false,
            destructiveHint: false,
          });
        }
        // Every listed tool carries an explicit openWorld hint.
        for (const tool of tools) {
          expect(typeof tool.annotations?.openWorldHint, `tool ${tool.name} openWorldHint`).toBe('boolean');
          expect(typeof tool.annotations?.readOnlyHint, `tool ${tool.name} readOnlyHint`).toBe('boolean');
        }
      } finally {
        await client.close();
      }
    } finally {
      await handle.close();
    }
  });

  it('annotates the same tools on the stdio server, whose extra actions read local files', async () => {
    const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, 'stdio');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'annotations-stdio-test', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t.annotations]));
      expect(byName.get('publish_video')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(byName.get('media')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(byName.get('persona_media')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    } finally {
      await client.close();
    }
  });
});
