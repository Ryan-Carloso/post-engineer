import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
}));

import { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools.js';
import { GeneratePersonaVideoOptionsSchema } from '../schedule-shapes.js';
import { ValidateScriptSchema } from '../single-video-shape.js';
import { handleGenerateVideo } from '../generate-video.js';
import { handleValidateScript } from '../tools-single-video.js';
import { hookTitleField } from '../hook-title-field.js';
import {
  HOOK_TITLE_CODES,
  HOOK_TITLE_MAX_CHARS,
  HOOK_TITLE_MAX_WORDS,
  HOOK_TITLE_SECONDS,
} from '../hook-title.js';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
const content =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const ctaTake = 'Save this video before your next trip to Porto.';

function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const segments = [
  { kind: 'hook' as const, text: hook, media: photos(5, 'hook') },
  { kind: 'content' as const, text: content, media: photos(8, 'content') },
  { kind: 'content' as const, text: ctaTake, media: photos(2, 'ctaTake') },
];

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

const AT_WORD_LIMIT = 'one two three four five six seven';
const AT_CHAR_LIMIT = 'a'.repeat(HOOK_TITLE_MAX_CHARS);
const REFUSED: Array<[string, string, string]> = [
  ['one word over the word limit', 'one two three four five six seven eight', HOOK_TITLE_CODES.tooManyWords],
  ['one character over the character limit', 'a'.repeat(HOOK_TITLE_MAX_CHARS + 1), HOOK_TITLE_CODES.tooLong],
  ['an empty string', '', HOOK_TITLE_CODES.empty],
  ['only spaces', '   ', HOOK_TITLE_CODES.empty],
  ['a newline', 'line one\nline two', HOOK_TITLE_CODES.invalidChars],
];

describe('hookTitle schema', () => {
  it.each([AT_WORD_LIMIT, AT_CHAR_LIMIT, 'I entered the sea clothed?'])('accepts %s in the generate_video options', (hookTitle) => {
    const parsed = GeneratePersonaVideoOptionsSchema.safeParse({ videoType: 'voiceover', hookTitle });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.hookTitle).toBe(hookTitle);
  });

  it.each(REFUSED)('refuses %s with its stable code', (_name, hookTitle, code) => {
    const parsed = GeneratePersonaVideoOptionsSchema.safeParse({ videoType: 'voiceover', hookTitle });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['hookTitle']);
      expect(parsed.error.issues[0]?.message.startsWith(`${code}: `)).toBe(true);
    }
  });

  it('is optional', () => {
    expect(GeneratePersonaVideoOptionsSchema.safeParse({ videoType: 'voiceover' }).success).toBe(true);
    expect(ValidateScriptSchema.safeParse({ segments }).success).toBe(true);
  });

  it('documents the limits it enforces, taken from the shared module', () => {
    const description = hookTitleField.description ?? '';
    expect(description).toContain(`${HOOK_TITLE_MAX_WORDS} words`);
    expect(description).toContain(`${HOOK_TITLE_MAX_CHARS} characters`);
    expect(description).toContain(`first ${HOOK_TITLE_SECONDS} seconds`);
    expect(description).toContain('HOOK_TITLE_*');
  });

  it('imports its limits from the shared module instead of retyping them', () => {
    const source = readFileSync(join(__dirname, '..', 'hook-title-field.ts'), 'utf8');
    expect(source).toContain("from './hook-title.js'");
    expect(source).not.toMatch(/\b60\b|\b7\b/);
  });
});

describe('generate_video hookTitle', () => {
  let client: PostEngineerClient;
  let generate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    generate = vi.fn().mockResolvedValue({
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 's1', slotAt: '2026-10-30T18:00:00Z', title: 'Porto trip', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
    });
    client = {
      listVoices: vi.fn().mockResolvedValue({ voices: [] }),
      generatePersonaVideo: generate,
      listPersonas: vi.fn().mockResolvedValue({ personas: [] }),
    } as unknown as PostEngineerClient;
  });

  function video(options: Record<string, unknown>) {
    return {
      personaId: undefined,
      title: 'Porto trip',
      description: 'Agent description.',
      segments,
      providers: ['youtube' as const],
      youtubeAccountIds: ['acct-1'],
      mode: 'asap' as const,
      timezone: 'UTC',
      options: { videoType: 'voiceover' as const, audioUrl: 'https://example.com/voice.mp3', ...options },
    };
  }

  it('sends options.hookTitle to the web route, which maps it to the engine hook_title', async () => {
    const response = await handleGenerateVideo(client, { videos: [video({ hookTitle: 'I entered the sea clothed?' })] } as never);
    expect(response.isError).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0].options.hookTitle).toBe('I entered the sea clothed?');
  });

  it('refuses a bad title in the handler, before any call that charges tokens', async () => {
    await expect(
      handleGenerateVideo(client, { videos: [video({ hookTitle: 'one two three four five six seven eight' })] } as never),
    ).rejects.toThrow(HOOK_TITLE_CODES.tooManyWords);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('check_script validate hookTitle', () => {
  function validateClient() {
    return {
      validateScript: vi.fn().mockResolvedValue({
        success: true,
        segmentCount: 3,
        totalWords: 76,
        hookWords: 25,
        contentWords: 51,
        hookWindowSeconds: { min: 8, max: 12 },
        measuredDurationSeconds: null,
        measured: 'pending',
        measuredReason: 'No hook-only TTS endpoint exists yet.',
      }),
    } as unknown as PostEngineerClient;
  }

  it.each(REFUSED)('reports %s with its stable code, without calling the web route', async (_name, hookTitle, code) => {
    const client = validateClient();
    const response = await handleValidateScript(client, { segments, videoType: 'voiceover', hookTitle });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain(`hookTitle: ${code}: `);
    expect(vi.mocked(client.validateScript)).not.toHaveBeenCalled();
  });

  it('passes a title at the limits through to the normal validation', async () => {
    const client = validateClient();
    const response = await handleValidateScript(client, { segments, videoType: 'voiceover', hookTitle: AT_WORD_LIMIT });
    expect(response.isError).toBeUndefined();
    expect(vi.mocked(client.validateScript)).toHaveBeenCalledTimes(1);
    expect(textOf(response)).toContain('Script valid');
  });

  it('is still valid without a title', async () => {
    const response = await handleValidateScript(validateClient(), { segments, videoType: 'voiceover' });
    expect(response.isError).toBeUndefined();
  });
});

describe('client request body', () => {
  it('forwards options.hookTitle to the web route', async () => {
    const client = new PostEngineerClient({ apiKey: 'test-token-123' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, schedule: { id: 'sch-1', mode: 'scheduled' }, slots: [], replayed: false }),
    });
    await client.generatePersonaVideo({
      personaId: 'persona-123',
      title: 'Porto trip',
      description: 'Agent description.',
      providers: ['youtube'],
      youtubeAccountIds: ['chan-1'],
      startAt: '2026-10-05T20:00:00',
      times: ['20:00'],
      timezone: 'Europe/Lisbon',
      options: { videoType: 'voiceover', hookTitle: 'I entered the sea clothed?' },
    });
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { options: Record<string, unknown> };
    expect(body.options.hookTitle).toBe('I entered the sea clothed?');
  });
});
