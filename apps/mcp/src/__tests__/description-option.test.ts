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
// description — the agent-supplied video description (issue #542
// follow-up). REQUIRED: the publish copy, sent top-level to the web
// route. There is no fallback to the title — a missing or blank
// description is rejected at the shape, before any charge.
//---------------
const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const segments = [
  { kind: 'hook' as const, text: hook, media: photos(3, 'hook') },
  { kind: 'body' as const, text: body, media: photos(6, 'body') },
  { kind: 'cta' as const, text: cta, media: photos(2, 'cta') },
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
  options: { videoType: 'hook_lipsync' as const },
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

describe('generate_persona_video description', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  it('keeps description on a call instead of stripping it', () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, description: 'Watch to the end.' });
    expect(parsed.description).toBe('Watch to the end.');
  });

  it('rejects a non-string description value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, description: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects a missing description', () => {
    const { description: _description, ...rest } = baseArgs;
    const result = GeneratePersonaVideoSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['description']);
    }
  });

  it('rejects a blank description (whitespace only)', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, description: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long description value', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, description: 'x'.repeat(5001) });
    expect(result.success).toBe(false);
  });

  it('forwards the parsed description to the generate-and-schedule body', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs, description: 'Watch to the end.' });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).description).toBe('Watch to the end.');
  });

  it('always sends description in the body (required, no fallback)', async () => {
    const parsed = GeneratePersonaVideoSchema.parse({ ...baseArgs });
    await new PostEngineerClient({ apiKey: 'test-token-123' }).generatePersonaVideo(parsed);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).description).toBe('Agent description.');
  });

  it('forwards description through the handler to the client', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      ...baseArgs,
      mode: 'scheduled',
      description: 'Watch to the end.',
    });
    expect(response.isError).toBeUndefined();
    const generate = vi.mocked(client.generatePersonaVideo);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].description).toBe('Watch to the end.');
  });
});
