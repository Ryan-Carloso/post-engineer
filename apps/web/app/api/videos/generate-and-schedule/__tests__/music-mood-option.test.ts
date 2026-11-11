// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';
import { checkSemantics } from '../request-validation';

//---------------
// options.musicMood — the route's zod boundary (issue #489) plus the
// pre-charge catalog check (issue #542 follow-up). The shape parse runs
// before auth, so a bad mood is a 400 with no charge and no DB touch.
// Both bounds are pinned: the 64-char cap mirrors the engine's
// VideoParams.music_mood max_length, and the 1-char floor rejects an
// empty mood. An unknown mood is rejected the same way, with the valid
// list — before the charge, not at engine dispatch after it.
//---------------
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

function bodyWithMood(musicMood: unknown) {
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
      musicMood,
      segments: [
        {
          kind: 'hook',
          text: 'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.',
          media: photos(3, 'hook'),
        },
        {
          kind: 'body',
          text: 'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.',
          media: photos(6, 'body'),
        },
        {
          kind: 'cta',
          text: 'Save this video before your next trip to Porto.',
          media: photos(2, 'cta'),
        },
      ],
    },
  };
}

describe('POST /api/videos/generate-and-schedule options.musicMood', () => {
  it('rejects a musicMood over 64 characters with a 400 naming the field', async () => {
    const res = await post(bodyWithMood('x'.repeat(65)));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string };
    expect(payload.field).toBe('options.musicMood');
  });

  it('rejects an empty musicMood with a 400 naming the field', async () => {
    const res = await post(bodyWithMood(''));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string };
    expect(payload.field).toBe('options.musicMood');
  });

  it('rejects an unknown musicMood with a 400 listing the valid moods', async () => {
    const res = await post(bodyWithMood('funky'));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string; error?: string };
    expect(payload.field).toBe('options.musicMood');
    expect(payload.error).toContain("unknown music mood: 'funky'");
    expect(payload.error).toContain('available moods: calm, energetic, inspiring, upbeat');
  });

  it('accepts a catalogued mood and none through semantics', () => {
    for (const musicMood of ['calm', 'none']) {
      const body = bodyWithMood(musicMood);
      const checked = checkSemantics({
        title: body.title,
        description: body.description,
        segments: body.options.segments,
        providers: body.publishing.providers,
        options: { videoType: body.options.videoType, musicMood },
        personaId: body.personaId,
      });
      expect(checked.ok).toBe(true);
    }
  });
});
