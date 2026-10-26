import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostEngineerClient } from '../client.js';
import { GeneratePersonaVideosSchema } from '../tools.js';

//---------------
// options.facelessMaterial — the per-post material choice (stock only or
// illustrations only, with or without a face). The options object is a
// zod object, which strips unknown keys: before the field existed an MCP
// caller's "svg" was dropped silently and the post rendered stock.
//---------------
const baseArgs = {
  personaId: 'persona-123',
  topics: ['Launch a SaaS in days'],
  providers: ['youtube'] as 'youtube'[],
  youtubeAccountIds: ['chan-1'],
  startAt: '2026-10-05T20:00:00',
  times: ['20:00'],
  timezone: 'Europe/Lisbon',
};

describe('generate_persona_videos options.facelessMaterial', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  it('keeps svg on a with-face call instead of stripping it', () => {
    const parsed = GeneratePersonaVideosSchema.parse({ ...baseArgs, options: { facelessMaterial: 'svg' } });
    expect(parsed.options).toEqual({ facelessMaterial: 'svg' });
  });

  it('rejects a value outside broll and svg', () => {
    const result = GeneratePersonaVideosSchema.safeParse({ ...baseArgs, options: { facelessMaterial: 'stock' } });
    expect(result.success).toBe(false);
  });

  it('forwards the parsed choice to the generate-and-schedule body', async () => {
    const parsed = GeneratePersonaVideosSchema.parse({
      ...baseArgs,
      options: { faceless: true, facelessMaterial: 'svg' },
    });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideos(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ faceless: true, facelessMaterial: 'svg' });
  });
});
