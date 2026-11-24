// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';
import { checkSemantics } from '../request-validation';
import { validateOptions } from '../options-validation';
import { buildGenerateJobRequest } from '../job-request';
import { buildJobPayload } from '@/lib/generation/video-job-payload';
import { HOOK_TITLE_CODES, HOOK_TITLE_MAX_CHARS } from '@/lib/generation/hook-title';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/videos/generate-and-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

function bodyWithOptions(options: Record<string, unknown>) {
  return {
    personaId: 'persona-123',
    title: 'Porto trip',
    description: 'Agent description.',
    publishing: {
      mode: 'scheduled',
      providers: ['youtube'],
      schedule: { startAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), times: ['20:00'], timezone: 'Europe/Lisbon' },
    },
    options: {
      videoType: 'hook_lipsync',
      ...options,
      segments: [
        {
          kind: 'hook',
          text: 'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.',
          media: photos(4, 'hook'),
        },
        {
          kind: 'content',
          text: 'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.',
          media: photos(8, 'content'),
        },
        {
          kind: 'content',
          text: 'Save this video before your next trip to Porto.',
          media: photos(2, 'ctaTake'),
        },
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/videos/generate-and-schedule hookTitle', () => {
  const cases: Array<[string, string, string]> = [
    ['more than seven words', 'one two three four five six seven eight', HOOK_TITLE_CODES.tooManyWords],
    ['more than sixty characters', 'a'.repeat(HOOK_TITLE_MAX_CHARS + 1), HOOK_TITLE_CODES.tooLong],
    ['an empty string', '', HOOK_TITLE_CODES.empty],
    ['only spaces', '   ', HOOK_TITLE_CODES.empty],
    ['a newline', 'line one\nline two', HOOK_TITLE_CODES.invalidChars],
    ['a control character', 'bell\u0007', HOOK_TITLE_CODES.invalidChars],
  ];

  it.each(cases)('rejects a title with %s with a 400 carrying its stable code, before any engine call', async (_name, hookTitle, code) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await post(bodyWithOptions({ hookTitle }));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as {
      field?: string;
      code?: string;
      errors?: Array<{ code: string; field?: string; message: string }>;
    };
    expect(payload.field).toBe('options.hookTitle');
    expect(payload.code).toBe(code);
    expect(payload.errors).toEqual([expect.objectContaining({ code, field: 'options.hookTitle' })]);
    expect(payload.errors?.[0].message.startsWith(`${code}: `)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a title at exactly the word and character limits through semantics', () => {
    for (const hookTitle of ['one two three four five six seven', 'a'.repeat(HOOK_TITLE_MAX_CHARS)]) {
      const checked = validateOptions({ videoType: 'voiceover', hookTitle });
      expect(checked.ok).toBe(true);
    }
  });

  it('keeps the title as written, collapsing only extra whitespace', () => {
    const checked = checkSemantics({
      title: 'Porto trip',
      description: 'Agent description.',
      segments: bodyWithOptions({}).options.segments,
      providers: ['youtube'],
      options: { videoType: 'hook_lipsync', hookTitle: '  I entered the   sea clothed?  ' },
      personaId: 'persona-123',
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.options.hookTitle).toBe('I entered the sea clothed?');
  });

  it('leaves the title out when none was sent', () => {
    const checked = validateOptions({ videoType: 'voiceover' });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.hookTitle).toBeUndefined();
  });
});

describe('hook_title in the engine request', () => {
  const base = {
    title: 'Porto trip',
    description: 'Agent description.',
    segmentsScript: 'Stop scrolling.',
    ctaType: null,
    generationId: 'gen-1',
    slotId: 'slot-1',
    segments: [{ kind: 'hook' as const, text: 'Stop scrolling.' }],
  };
  const persona = { name: 'Ana' };

  it('carries the validated title into the job request and through the payload allowlist', () => {
    const request = buildGenerateJobRequest({
      ...base,
      validatedOptions: { videoType: 'voiceover', hookTitle: 'I entered the sea clothed?' },
    });
    expect(request.hook_title).toBe('I entered the sea clothed?');
    expect(buildJobPayload(persona, request).hook_title).toBe('I entered the sea clothed?');
  });

  it('sends no hook_title when none was asked for', () => {
    const request = buildGenerateJobRequest({ ...base, validatedOptions: { videoType: 'voiceover' } });
    expect(JSON.stringify(buildJobPayload(persona, request))).not.toContain('hook_title');
  });
});
