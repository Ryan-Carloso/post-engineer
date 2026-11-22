// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';
import { checkSemantics } from '../request-validation';

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

describe('POST /api/videos/generate-and-schedule pacing options', () => {
  it('rejects a videoClipDuration outside 1-60 with a 400 naming the field', async () => {
    for (const videoClipDuration of [0, 61]) {
      const res = await post(bodyWithOptions({ videoClipDuration }));
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { field?: string };
      expect(payload.field).toBe('options.videoClipDuration');
    }
  });

  it('rejects an unknown videoTransitionMode with a 400 naming the field', async () => {
    const res = await post(bodyWithOptions({ videoTransitionMode: 'Dissolve' }));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string };
    expect(payload.field).toBe('options.videoTransitionMode');
  });

  it('rejects a non-integer videoVariationSeed with a 400 naming the field', async () => {
    for (const videoVariationSeed of [1.5, 'abc']) {
      const res = await post(bodyWithOptions({ videoVariationSeed }));
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { field?: string };
      expect(payload.field).toBe('options.videoVariationSeed');
    }
  });

  it('accepts the pacing options through semantics', () => {
    const body = bodyWithOptions({ videoClipDuration: 4, videoTransitionMode: 'Crossfade', videoVariationSeed: 7 });
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: {
        videoType: body.options.videoType,
        videoClipDuration: 4,
        videoTransitionMode: 'Crossfade',
        videoVariationSeed: 7,
      },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.options.videoClipDuration).toBe(4);
      expect(checked.value.options.videoTransitionMode).toBe('Crossfade');
      expect(checked.value.options.videoVariationSeed).toBe(7);
    }
  });

  it('rejects an out-of-range videoClipDuration through semantics', () => {
    const body = bodyWithOptions({ videoClipDuration: 0 });
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: { videoType: body.options.videoType, videoClipDuration: 0 },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.some((issue) => issue.field === 'options.videoClipDuration')).toBe(true);
    }
  });

  it('rejects an unknown videoTransitionMode through semantics', () => {
    const body = bodyWithOptions({ videoTransitionMode: 'Dissolve' });
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: { videoType: body.options.videoType, videoTransitionMode: 'Dissolve' },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.some((issue) => issue.field === 'options.videoTransitionMode')).toBe(true);
    }
  });
});
