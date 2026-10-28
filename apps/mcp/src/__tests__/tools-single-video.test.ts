import { describe, it, expect, vi } from 'vitest';
import {
  handleGeneratePersonaVideo,
  handleValidateScript,
} from '../tools-single-video.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools.js';

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

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

function mockClient() {
  return {
    generatePersonaVideos: vi.fn().mockResolvedValue({
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 's1', slotAt: '2026-10-30T18:00:00Z', topic: 'Porto trip', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
    }),
    validateScript: vi.fn().mockResolvedValue({
      success: true,
      segmentCount: 3,
      totalWords: 75,
      hookWords: 24,
      bodyWords: 42,
      ctaWords: 9,
      hookWindowSeconds: { min: 8, max: 12 },
      measuredDurationSeconds: null,
      measured: 'pending',
      measuredReason: 'No hook-only TTS endpoint exists yet.',
    }),
  } as unknown as PostEngineerClient;
}

describe('generate_persona_video tool', () => {
  it('calls the web route once with a single topic and the segments, and renders the slot', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      personaId: 'persona-1',
      segments,
      title: 'Porto trip',
      language: 'en-US',
      providers: ['youtube'],
      youtubeAccountIds: ['acct-1'],
      mode: 'scheduled',
      startAt: '2026-10-30T18:00:00',
      times: ['18:00'],
      timezone: 'Europe/Lisbon',
    });
    expect(response.isError).toBeUndefined();
    const generate = vi.mocked(client.generatePersonaVideos);
    expect(generate).toHaveBeenCalledTimes(1);
    const input = generate.mock.calls[0][0];
    expect(input.topics).toEqual(['Porto trip']);
    expect(input.options).toMatchObject({ segments, language: 'en-US' });
    expect(textOf(response)).toContain('Porto trip');
  });

  it('lets options.language win over the top-level language', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideo(client, {
      personaId: 'persona-1',
      segments,
      title: 'Porto trip',
      language: 'en-US',
      options: { language: 'en-GB' },
      providers: ['youtube'],
      mode: 'asap',
      timezone: 'Europe/Lisbon',
    });
    expect(response.isError).toBeUndefined();
    const input = vi.mocked(client.generatePersonaVideos).mock.calls[0][0];
    expect(input.options).toMatchObject({ language: 'en-GB' });
  });

  it('fails fast on invalid segments without calling the client (no token debit)', async () => {
    const client = mockClient();
    const bad = [
      { kind: 'body' as const, text: body },
      { kind: 'hook' as const, text: hook },
      { kind: 'cta' as const, text: cta },
    ];
    const response = await handleGeneratePersonaVideo(client, {
      personaId: 'persona-1',
      segments: bad,
      title: 'Porto trip',
      providers: ['youtube'],
      mode: 'asap',
      timezone: 'Europe/Lisbon',
    });
    expect(response.isError).toBe(true);
    expect(vi.mocked(client.generatePersonaVideos)).not.toHaveBeenCalled();
    expect(textOf(response)).toContain('segments');
  });
});

describe('validate_script tool', () => {
  it('accepts a valid script and reports the hook word count and the 8-12s window', async () => {
    const response = await handleValidateScript(mockClient(), { segments });
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('8');
    expect(text).toContain('12');
    expect(text).toContain('hook');
  });

  it('calls the web validate-script endpoint once with the segments and reports its counts', async () => {
    const client = mockClient();
    const response = await handleValidateScript(client, { segments });
    expect(response.isError).toBeUndefined();
    expect(vi.mocked(client.validateScript)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.validateScript)).toHaveBeenCalledWith(segments);
    const text = textOf(response);
    expect(text).toContain('3 segment(s)');
    expect(text).toContain('75 words total');
    expect(text).toContain('pending');
  });

  it('rejects a hook outside the 15-40 word guard without calling the endpoint or measuring TTS', async () => {
    const client = mockClient();
    const response = await handleValidateScript(client, {
      segments: [
        { kind: 'hook' as const, text: 'Short hook here today.' },
        { kind: 'body' as const, text: body },
        { kind: 'cta' as const, text: cta },
      ],
    });
    expect(response.isError).toBe(true);
    expect(vi.mocked(client.validateScript)).not.toHaveBeenCalled();
    expect(textOf(response)).toContain('hook');
  });

  it('states that measured duration is pending the hook-only TTS endpoint', async () => {
    const response = await handleValidateScript(mockClient(), { segments });
    expect(textOf(response)).toMatch(/measured duration/i);
  });

  it('returns an error when the web endpoint rejects the script', async () => {
    const client = mockClient();
    vi.mocked(client.validateScript).mockResolvedValue({ success: false, error: 'Script rejected.' });
    const response = await handleValidateScript(client, { segments });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Script rejected');
  });
});
