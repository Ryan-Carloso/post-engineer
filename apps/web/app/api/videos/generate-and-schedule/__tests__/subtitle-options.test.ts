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

describe('POST /api/videos/generate-and-schedule subtitle position options', () => {
  it('rejects an unknown subtitlePosition with a 400 naming the field', async () => {
    const res = await post(bodyWithOptions({ subtitlePosition: 'side' }));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string };
    expect(payload.field).toBe('options.subtitlePosition');
  });

  it('rejects a subtitleCustomPosition outside 0-100 with a 400 naming the field', async () => {
    for (const subtitleCustomPosition of [-1, 101, 12.5]) {
      const res = await post(bodyWithOptions({ subtitlePosition: 'custom', subtitleCustomPosition }));
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { field?: string };
      expect(payload.field).toBe('options.subtitleCustomPosition');
    }
  });

  it('rejects a subtitleCustomPosition without a custom subtitlePosition with a 400 naming the field', async () => {
    for (const subtitlePosition of [undefined, 'top', 'center', 'bottom']) {
      const res = await post(bodyWithOptions({ subtitlePosition, subtitleCustomPosition: 20 }));
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { field?: string };
      expect(payload.field).toBe('options.subtitleCustomPosition');
    }
  });

  it('accepts the subtitle position options through semantics', () => {
    const body = bodyWithOptions({ subtitlePosition: 'top' });
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: {
        videoType: body.options.videoType,
        subtitlePosition: 'top',
      },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.options.subtitlePosition).toBe('top');
    }
  });

  it('accepts a custom subtitle position with its height through semantics', () => {
    const body = bodyWithOptions({ subtitlePosition: 'custom', subtitleCustomPosition: 20 });
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: {
        videoType: body.options.videoType,
        subtitlePosition: 'custom',
        subtitleCustomPosition: 20,
      },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.options.subtitlePosition).toBe('custom');
      expect(checked.value.options.subtitleCustomPosition).toBe(20);
    }
  });

  it('rejects a subtitleCustomPosition without custom through semantics', () => {
    const body = bodyWithOptions({ subtitlePosition: 'top', subtitleCustomPosition: 20 });
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: { videoType: body.options.videoType, subtitlePosition: 'top', subtitleCustomPosition: 20 },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.some((issue) => issue.field === 'options.subtitleCustomPosition')).toBe(true);
    }
  });
});
