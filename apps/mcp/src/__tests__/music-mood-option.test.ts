import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
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
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { musicMood: 'calm' } });
    expect(parsed.options).toEqual({ musicMood: 'calm' });
  });

  it('rejects a non-string musicMood value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { musicMood: 5 } });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long musicMood value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { musicMood: 'x'.repeat(65) } });
    expect(result.success).toBe(false);
  });

  it('forwards the parsed choice to the generate-and-schedule body under the web field name', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { musicMood: 'calm' } });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ musicMood: 'calm' });
  });

  it('omits musicMood from the body when unset, so existing behaviour is unchanged', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toBeUndefined();
  });

  it('forwards musicMood through the handler to the client on a with-face call', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      options: { musicMood: 'calm' },
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
      options: { faceless: true, musicMood: 'upbeat' },
    });
    expect(response.isError).toBeUndefined();
    const generate = vi.mocked(client.generatePersonaVideo);
    expect(generate.mock.calls[0][0].options?.musicMood).toBe('upbeat');
  });
});
