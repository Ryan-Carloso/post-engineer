// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';

//---------------
// options.musicMood — the route's zod boundary (issue #489). The shape
// parse runs before auth, so a bad mood is a 400 with no charge and no
// DB touch. Both bounds are pinned: the 64-char cap mirrors the engine's
// VideoParams.music_mood max_length, and the 1-char floor rejects an
// empty mood. Stryker swaps max<->min on this line; either surviving
// mutant means a bad mood slips through to the engine.
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

function bodyWithMood(musicMood: unknown) {
  return {
    title: 'Porto trip',
    publishing: { providers: ['youtube'] },
    options: { musicMood },
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
});
