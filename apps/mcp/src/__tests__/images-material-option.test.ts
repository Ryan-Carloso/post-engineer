import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

import { PostEngineerClient } from '../client.js';
import { GeneratePersonaVideoSchema, ValidateScriptSchema } from '../single-video-shape.js';
import { handleGeneratePersonaVideo, handleValidateScript } from '../tools-single-video.js';
import { RecipeSession, withScriptOutcome } from '../recipe-session.js';
import type { McpToolResponse } from '../tools.js';

//---------------
// facelessMaterial "images" (issue #481): the video shows only the
// segment images, so every segment needs media. The MCP checks it
// locally before any client call (no token is ever charged for a script
// the web would reject) and forwards the material to the web.
//---------------
const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({ url: `https://e.com/${prefix}${index}.jpg` }));
}
const withMedia = [
  { kind: 'hook' as const, text: hook, media: photos(3, 'h') },
  { kind: 'body' as const, text: body, media: [{ mediaId: `${'a'.repeat(32)}.jpg` }, ...photos(5, 'b')] },
  { kind: 'cta' as const, text: cta, media: photos(2, 'c') },
];
const sparseMedia = [
  { kind: 'hook' as const, text: hook, media: photos(1, 'h') },
  { kind: 'body' as const, text: body, media: [{ mediaId: `${'a'.repeat(32)}.jpg` }] },
  { kind: 'cta' as const, text: cta, media: photos(1, 'c') },
];
const bodyWithoutMedia = withMedia.map((segment, index) =>
  index === 1 ? { kind: segment.kind, text: segment.text } : segment,
);
const baseArgs = {
  personaId: 'persona-123',
  title: 'Porto trip',
  providers: ['youtube'] as 'youtube'[],
  youtubeAccountIds: ['chan-1'],
  startAt: '2026-10-05T20:00:00',
  times: ['20:00'],
  timezone: 'Europe/Lisbon',
  mode: 'scheduled' as const,
};

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

function mockClient() {
  return {
    listVoices: vi.fn().mockResolvedValue({ voices: [] }),
    validateScript: vi.fn().mockResolvedValue({
      success: true, valid: true, segmentCount: 3, totalWords: 75, hookWords: 24, bodyWords: 42, ctaWords: 9,
      measured: 'pending', measuredDurationSeconds: null,
    }),
    generatePersonaVideo: vi.fn().mockResolvedValue({
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 's1', slotAt: '2026-10-30T18:00:00Z', title: 'Porto trip', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
    }),
  } as unknown as PostEngineerClient;
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) });
});

describe('generate_persona_video with facelessMaterial "images"', () => {
  it('accepts images in the options schema and rejects an unknown material', () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, segments: withMedia, options: { facelessMaterial: 'images' } });
    expect(parsed.options?.facelessMaterial).toBe('images');
    expect(GeneratePersonaVideoSchema.safeParse({ ...baseArgs, segments: withMedia, options: { facelessMaterial: 'photos' } }).success).toBe(false);
  });

  it('rejects a segment without media before any client call', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs, segments: bodyWithoutMedia, options: { faceless: true, facelessMaterial: 'images' },
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('segments.1.media: the images material needs media on every segment');
    expect(vi.mocked(client.generatePersonaVideo)).not.toHaveBeenCalled();
  });

  it('forwards images to the client when every segment carries media', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs, segments: withMedia, options: { faceless: true, facelessMaterial: 'images' },
    });
    expect(response.isError).toBeUndefined();
    expect(vi.mocked(client.generatePersonaVideo).mock.calls[0][0].options?.facelessMaterial).toBe('images');
  });

  it('sends images to generate-and-schedule under the web field name', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, segments: withMedia, options: { facelessMaterial: 'images' } });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ facelessMaterial: 'images' });
  });

  it('keeps media optional for the default material', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, { ...baseArgs, segments: bodyWithoutMedia });
    expect(response.isError).toBeUndefined();
  });
});

describe('validate_script with facelessMaterial', () => {
  it('rejects a segment without media locally, without calling the web', async () => {
    const client = mockClient();
    const response = await handleValidateScript(client, { segments: bodyWithoutMedia, facelessMaterial: 'images' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('segments.1.media');
    expect(vi.mocked(client.validateScript)).not.toHaveBeenCalled();
  });

  it('forwards the material to the web validation', async () => {
    const client = mockClient();
    const response = await handleValidateScript(client, { segments: withMedia, facelessMaterial: 'images' });
    expect(response.isError).toBeUndefined();
    expect(vi.mocked(client.validateScript)).toHaveBeenCalledWith(withMedia, 'images');
  });

  it('accepts the material in the schema and posts it in the body', async () => {
    expect(ValidateScriptSchema.parse({ segments: withMedia, facelessMaterial: 'images' }).facelessMaterial).toBe('images');
    expect(ValidateScriptSchema.safeParse({ segments: withMedia, facelessMaterial: 'photos' }).success).toBe(false);
    await new PostEngineerClient({ apiKey: 'test-token-123' }).validateScript(withMedia, 'images');
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ segments: withMedia, facelessMaterial: 'images' });
  });

  it('omits the material from the body when unset', async () => {
    await new PostEngineerClient({ apiKey: 'test-token-123' }).validateScript(sparseMedia);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ segments: sparseMedia });
  });
});

describe('script outcome telemetry with the images material', () => {
  it('counts a missing image as a rejected script', async () => {
    const session = new RecipeSession('stdio');
    const recorded = vi.spyOn(session, 'recordScriptRejected');
    const wrapped = withScriptOutcome(session, 'validate_script', async () => ({
      content: [{ type: 'text' as const, text: 'Script validation failed' }],
      isError: true,
    }));
    await wrapped({ segments: bodyWithoutMedia, facelessMaterial: 'images' });
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('does not count a failure as a script rejection when the script is valid for its material', async () => {
    const session = new RecipeSession('stdio');
    const recorded = vi.spyOn(session, 'recordScriptRejected');
    const wrapped = withScriptOutcome(session, 'generate_persona_video', async () => ({
      content: [{ type: 'text' as const, text: 'upstream error' }],
      isError: true,
    }));
    await wrapped({ segments: withMedia, options: { facelessMaterial: 'images' } });
    expect(recorded).not.toHaveBeenCalled();
  });
});
