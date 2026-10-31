import { describe, it, expect, vi } from 'vitest';
import {
  handleGeneratePersonaVideo,
  handleScoreDraft,
  handleValidateScript,
} from '../tools-single-video.js';
import type { PostEngineerClient } from '../client.js';
import { ApiError } from '../errors.js';
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
    generatePersonaVideo: vi.fn().mockResolvedValue({
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 's1', slotAt: '2026-10-30T18:00:00Z', title: 'Porto trip', taskId: 'task-1', status: 'scheduled' }],
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
  it('calls the web route once with a title and the segments (never a topics key), and renders the slot', async () => {
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
    const generate = vi.mocked(client.generatePersonaVideo);
    expect(generate).toHaveBeenCalledTimes(1);
    const input = generate.mock.calls[0][0];
    expect(input.title).toBe('Porto trip');
    expect(input).not.toHaveProperty('topics');
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
    const input = vi.mocked(client.generatePersonaVideo).mock.calls[0][0];
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
    expect(vi.mocked(client.generatePersonaVideo)).not.toHaveBeenCalled();
    expect(textOf(response)).toContain('segments');
  });

  it('redacts credential-shaped material from a thrown endpoint error', async () => {
    const client = mockClient();
    vi.mocked(client.generatePersonaVideo).mockRejectedValue(
      new ApiError('Failed to generate: 500 Bearer abc123token https://admin:s3cret@example.com/x', null, null),
    );
    const response = await handleGeneratePersonaVideo(client, {
      personaId: 'persona-1',
      segments,
      title: 'Porto trip',
      language: 'en-US',
      providers: ['youtube'],
      youtubeAccountIds: ['acct-1'],
      mode: 'asap',
      timezone: 'Europe/Lisbon',
    });
    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('https://[redacted]@example.com');
    expect(text).not.toContain('abc123token');
    expect(text).not.toContain('s3cret');
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

  it('redacts credential-shaped material from a thrown endpoint error', async () => {
    const client = mockClient();
    vi.mocked(client.validateScript).mockRejectedValue(
      new ApiError('Failed to validate: 500 Bearer abc123token https://admin:s3cret@example.com/x', null, null),
    );
    const response = await handleValidateScript(client, { segments });
    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('https://[redacted]@example.com');
    expect(text).not.toContain('abc123token');
    expect(text).not.toContain('s3cret');
  });
});

describe('score_draft tool', () => {
  const HEADERS = { Authorization: 'Bearer <redacted>' };

  function fakeClient(request: ReturnType<typeof vi.fn>) {
    return {
      request,
      getHeaders: vi.fn().mockReturnValue(HEADERS),
    } as unknown as PostEngineerClient;
  }

  it('POSTs the draft to /api/videos/score-draft and renders the score JSON', async () => {
    const payload = {
      success: true,
      score: 100,
      reasons: [{ rule: 'hook', detail: 'First line is 10 words.', points: 20 }],
      counts: { chars: 400, words: 54, hashtags: 2, links: 0, firstLineWords: 10, slopHits: [], topThemeMatch: 'Porto mornings' },
      baseline: { postsMeasured: 2, topAngles: [], medianEngagement: 82.5, bestEngagement: 115 },
      publishCheck: { ok: true, failures: [], warnings: [] },
    };
    const request = vi.fn().mockResolvedValue(payload);
    const response = await handleScoreDraft(fakeClient(request), { draft: 'The best Porto mornings start before the tourists wake up.' });
    expect(request).toHaveBeenCalledWith(
      '/api/videos/score-draft',
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ draft: 'The best Porto mornings start before the tourists wake up.' }),
      },
      'score draft',
    );
    expect(response.isError).not.toBe(true);
    expect(textOf(response)).toContain('"score": 100');
  });

  it('sends only the set optionals', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, score: 50 });
    await handleScoreDraft(fakeClient(request), {
      draft: 'Draft.',
      provider: 'linkedin',
      personaId: '11111111-2222-4333-8444-555555555555',
    });
    expect(request).toHaveBeenCalledWith(
      '/api/videos/score-draft',
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          draft: 'Draft.',
          provider: 'linkedin',
          personaId: '11111111-2222-4333-8444-555555555555',
        }),
      },
      'score draft',
    );
  });

  it('returns an error when the web endpoint rejects the draft', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Failed to score draft: 500 boom'));
    const response = await handleScoreDraft(fakeClient(request), { draft: 'Draft.' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error scoring draft');
  });
});
