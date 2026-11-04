import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

import { PostEngineerClient } from '../client.js';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';
import { handleGeneratePersonaVideo } from '../tools-single-video.js';
import type { McpToolResponse } from '../tools.js';

//---------------
// options.fullLipsync — render the whole video as the persona talking,
// with no b-roll. The web route already accepts options.fullLipsync;
// the MCP options object is a zod object, which strips unknown keys,
// so before this field existed an MCP caller's request was dropped
// silently and the post rendered intro-only lip-sync over stock.
//---------------
const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
const segments = [
  { kind: 'hook' as const, text: hook },
  { kind: 'body' as const, text: body },
  { kind: 'cta' as const, text: cta },
];
const baseArgs = {
  personaId: 'persona-123',
  segments,
  title: 'Launch a SaaS in days',
  providers: ['youtube'] as 'youtube'[],
  youtubeAccountIds: ['chan-1'],
  startAt: '2026-10-05T20:00:00',
  times: ['20:00'],
  timezone: 'Europe/Lisbon',
};

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

function mockClient() {
  return {
    listVoices: vi.fn().mockResolvedValue({ voices: [] }),
    generatePersonaVideo: vi.fn().mockResolvedValue({
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 's1', slotAt: '2026-10-30T18:00:00Z', title: 'Porto trip', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
    }),
  } as unknown as PostEngineerClient;
}

describe('generate_persona_video options.fullLipsync', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  it('keeps fullLipsync on a with-face call instead of stripping it', () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { fullLipsync: true } });
    expect(parsed.options).toEqual({ fullLipsync: true });
  });

  it('rejects a non-boolean fullLipsync value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { fullLipsync: 'yes' } });
    expect(result.success).toBe(false);
  });

  it('forwards the parsed choice to the generate-and-schedule body under the web field name', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { fullLipsync: true } });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ fullLipsync: true });
  });

  it('omits fullLipsync from the body when unset, so existing behaviour is unchanged', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toBeUndefined();
  });

  it('rejects fullLipsync combined with faceless before any client call', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { faceless: true, fullLipsync: true },
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('options.fullLipsync cannot be used with faceless videos');
    expect(vi.mocked(client.generatePersonaVideo)).not.toHaveBeenCalled();
  });

  it('rejects fullLipsync without a persona before any client call', async () => {
    const client = mockClient();
    const { personaId: _dropped, ...noPersonaArgs } = baseArgs;
    const response = await handleGeneratePersonaVideo(client, {
      ...noPersonaArgs,
      mode: 'scheduled',
      options: { fullLipsync: true },
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('options.fullLipsync requires a persona');
    expect(vi.mocked(client.generatePersonaVideo)).not.toHaveBeenCalled();
  });

  it('forwards fullLipsync through the handler to the client on a with-face call', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { fullLipsync: true },
    });
    expect(response.isError).toBeUndefined();
    const generate = vi.mocked(client.generatePersonaVideo);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].options?.fullLipsync).toBe(true);
  });
});
