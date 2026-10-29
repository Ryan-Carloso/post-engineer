import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostEngineerClient } from '../client.js';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';

//---------------
// options.facelessMaterial — the per-post material choice (stock only or
// illustrations only, with or without a face). The options object is a
// zod object, which strips unknown keys: before the field existed an MCP
// caller's "svg" was dropped silently and the post rendered stock.
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

describe('generate_persona_video options.facelessMaterial', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  it('keeps svg on a with-face call instead of stripping it', () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, options: { facelessMaterial: 'svg' } });
    expect(parsed.options).toEqual({ facelessMaterial: 'svg' });
  });

  it('rejects a value outside broll and svg', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { facelessMaterial: 'stock' } });
    expect(result.success).toBe(false);
  });

  it('forwards the parsed choice to the generate-and-schedule body', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({
      ...baseArgs,
      options: { faceless: true, facelessMaterial: 'svg' },
    });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).options).toEqual({ faceless: true, facelessMaterial: 'svg' });
  });
});
