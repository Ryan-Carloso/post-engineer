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
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

// ChatGPT and other annotation-aware clients use these hints to decide
// whether to auto-approve, confirm, or warn. Every tool must carry them:
// read-only for list_*/get_*/check_*/validate/score, destructive for
// delete_*/publish/disconnect/cancel, and a plain write hint otherwise.
const READ_ONLY_TOOLS = [
  'list_personas',
  'list_voices',
  'list_cloned_voices',
  'get_cloned_voice',
  'list_faces',
  'list_social_accounts',
  'list_pinterest_boards',
  'get_persona_publishing_accounts',
  'list_schedules',
  'list_posts',
  'get_slot',
  'list_video_generations',
  'get_video_generation',
  'get_post',
  'get_post_metrics',
  'get_youtube_retention_curve',
  'list_token_transactions',
  'get_persona_delete_preview',
  'get_token_balance',
  'validate_script',
  'score_draft',
  'check_media',
  'list_experiments',
  'get_experiment_results',
  'get_video_status',
  'get_video_task_progress',
  'wait_for_video_tasks',
  'list_persona_images',
  'list_prompts',
  'get_prompt',
];

const DESTRUCTIVE_TOOLS = [
  'delete_cloned_voice',
  'cancel_schedule',
  'delete_slot',
  'cancel_video_task',
  'delete_persona',
  'disconnect_account',
  'remove_persona_image',
  'publish_video_direct',
  'publish_uploaded_video',
];

const MUTATING_TOOLS = [
  'create_persona',
  'create_cloned_voice',
  'preview_cloned_voice',
  'preview_house_voice',
  'update_persona',
  'set_persona_publishing_accounts',
  'connect_account',
  'update_slot_title',
  'generate_persona_video',
  'generate_persona_video_batch',
  'create_experiment',
  'add_experiment_pair',
  'update_persona_image',
  'upload_media',
  'add_persona_image',
  'create_video_upload',
  'complete_video_upload',
];

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
        // The remote surface has no local-file tools.
        expect(byName.has('publish_video_direct')).toBe(false);
        const stdioOnly = new Set(['publish_video_direct', 'upload_media', 'add_persona_image']);
        for (const name of [...READ_ONLY_TOOLS, ...DESTRUCTIVE_TOOLS, ...MUTATING_TOOLS]) {
          if (stdioOnly.has(name)) continue;
          expect(byName.get(name), `tool ${name} must be listed`).toBeDefined();
        }
        for (const name of READ_ONLY_TOOLS) {
          expect(byName.get(name), `tool ${name}`).toMatchObject({
            readOnlyHint: true,
            destructiveHint: false,
          });
        }
        for (const name of DESTRUCTIVE_TOOLS) {
          if (name === 'publish_video_direct') continue; // stdio-only, checked below
          expect(byName.get(name), `tool ${name}`).toMatchObject({
            readOnlyHint: false,
            destructiveHint: true,
          });
        }
        for (const name of MUTATING_TOOLS) {
          if (name === 'upload_media' || name === 'add_persona_image') continue; // stdio-only
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

  it('annotates the stdio-only local-file tools too', async () => {
    const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, 'stdio');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'annotations-stdio-test', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t.annotations]));
      expect(byName.get('publish_video_direct')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(byName.get('upload_media')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(byName.get('add_persona_image')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    } finally {
      await client.close();
    }
  });
});
