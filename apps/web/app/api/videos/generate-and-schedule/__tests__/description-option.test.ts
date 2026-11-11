// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';
import { checkSemantics } from '../request-validation';

//---------------
// POST /api/videos/generate-and-schedule — description is REQUIRED
// (issue #542 follow-up): the agent supplies the publish copy, there is
// no fallback to the subject or to a mechanical caption. The shape parse
// runs before auth, so a missing description is a 400 with no charge and
// no DB touch. The 5000-char cap mirrors VideoParams.video_description.
// The route is never reached past validation in this env (auth throws on
// cookies() outside a request scope), so the pass-through case goes
// through checkSemantics directly.
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

function bodyWithDescription(description: string) {
  return {
    personaId: 'persona-123',
    title: 'Porto trip',
    description,
    publishing: {
      mode: 'scheduled',
      providers: ['youtube'],
      schedule: { startAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), times: ['20:00'], timezone: 'Europe/Lisbon' },
    },
    options: {
      videoType: 'hook_lipsync',
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

function bodyWithoutDescription() {
  const { description, ...rest } = bodyWithDescription('Agent description.');
  void description;
  return rest;
}

describe('POST /api/videos/generate-and-schedule description', () => {
  it('rejects a request without a description with a 400 naming the field', async () => {
    const res = await post(bodyWithoutDescription());
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string; error?: string };
    expect(payload.field).toBe('description');
    expect(payload.error).toContain('description is required');
  });

  it('rejects a description over 5000 characters with a 400 naming the field', async () => {
    const res = await post(bodyWithDescription('x'.repeat(5001)));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string };
    expect(payload.field).toBe('description');
  });

  it('rejects a blank description with a 400 naming the field', async () => {
    const res = await post(bodyWithDescription('   '));
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { field?: string };
    expect(payload.field).toBe('description');
  });

  it('passes a 5000-character description through semantics unchanged', () => {
    const body = bodyWithDescription('x'.repeat(5000));
    const checked = checkSemantics({
      title: body.title,
      description: body.description,
      segments: body.options.segments,
      providers: body.publishing.providers,
      options: { videoType: body.options.videoType },
      personaId: body.personaId,
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.description).toBe('x'.repeat(5000));
  });
});
