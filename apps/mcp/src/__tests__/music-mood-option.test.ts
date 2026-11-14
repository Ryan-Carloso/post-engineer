import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

import { PostEngineerClient } from '../client.js';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';
import { handleGeneratePersonaVideo } from '../tools-single-video.js';

//---------------
// options.musicMood — background-music mood for the video. The web route
// already accepts options.musicMood; the MCP options object is a zod
// object, which strips unknown keys, so before this field existed an MCP
// caller's request was dropped silently and the video rendered with the
// engine's default mood instead of the requested one.
//---------------
const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const content =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const ctaTake = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const segments = [
  { kind: 'hook' as const, text: hook, media: photos(3, 'hook') },
  { kind: 'content' as const, text: content, media: photos(6, 'content') },
  { kind: 'content' as const, text: ctaTake, media: photos(2, 'ctaTake') },
];
const baseArgs = {
  personaId: 'persona-123',
  segments,
  title: 'Launch a SaaS in days',
  description: 'Agent description.',
  providers: ['youtube'] as 'youtube'[],
  youtubeAccountIds: ['chan-1'],
  startAt: '2026-10-05T20:00:00',
  times: ['20:00'],
  timezone: 'Europe/Lisbon',
};

function textOf(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text ?? '';
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

describe('generate_persona_video options.musicMood', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  it('keeps musicMood on a with-face call instead of stripping it', () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { videoType: 'hook_lipsync', musicMood: 'calm' } });
    expect(parsed.options).toEqual({ videoType: 'hook_lipsync', musicMood: 'calm' });
  });

  it('rejects a non-string musicMood value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { videoType: 'hook_lipsync', musicMood: 5 } });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long musicMood value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { videoType: 'hook_lipsync', musicMood: 'x'.repeat(65) } });
    expect(result.success).toBe(false);
  });

  it('forwards the parsed choice to the generate-and-schedule body under the web field name', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { videoType: 'hook_lipsync', musicMood: 'calm' } });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ videoType: 'hook_lipsync', musicMood: 'calm' });
  });

  it('omits musicMood from the body when unset, so existing behaviour is unchanged', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { videoType: 'hook_lipsync' } });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ videoType: 'hook_lipsync' });
  });

  it('forwards musicMood through the handler to the client on a with-face call', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { videoType: 'hook_lipsync', musicMood: 'calm' },
    });
    expect(response.isError).toBeUndefined();
    const generate = vi.mocked(client.generatePersonaVideo);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].options?.musicMood).toBe('calm');
  });

  it('forwards musicMood on a faceless call too — BGM has no face to render', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { videoType: 'faceless', musicMood: 'upbeat' },
    });
    expect(response.isError).toBeUndefined();
    const generate = vi.mocked(client.generatePersonaVideo);
    expect(generate.mock.calls[0][0].options?.musicMood).toBe('upbeat');
  });

  it('relays a web 400 for an unknown mood to the agent with the valid moods listed', async () => {
    // The web rejects an unknown mood pre-charge with the list of valid
    // moods; the MCP relays it through errors.ts (200-char cap), so the
    // agent sees the reason, not a generic failure.
    const webBody = JSON.stringify({
      success: false,
      code: 'validation_failed',
      error: "unknown music mood: 'funky'; available moods: calm, energetic, inspiring, upbeat",
      field: 'options.musicMood',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => webBody });
    const client = new PostEngineerClient({ apiKey: 'test-token-123' });
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { videoType: 'hook_lipsync', musicMood: 'funky' },
    });
    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain("unknown music mood: 'funky'");
    expect(text).toContain('available moods: calm, energetic, inspiring, upbeat');
  });

  it('relays a web 400 for an unknown video_type to the agent with the modes and costs listed', async () => {
    // Same relay path as the mood: the short video_type message must
    // arrive whole, costs included, under the 200-char cap.
    const webBody = JSON.stringify({
      success: false,
      code: 'validation_failed',
      error: "unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
      field: 'options.videoType',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => webBody });
    const client = new PostEngineerClient({ apiKey: 'test-token-123' });
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { videoType: 'hook_lipsync' },
    });
    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain("unknown video_type 'sideways'");
    expect(text).toContain('full_lipsync (8/15)');
    expect(text).toContain('hook_lipsync (2/3)');
    expect(text).toContain('faceless (1)');
  });
});
