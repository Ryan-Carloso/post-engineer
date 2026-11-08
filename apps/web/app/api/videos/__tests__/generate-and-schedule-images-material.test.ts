// @vitest-environment node
//---------------
// The "images" material (issue #481) on generate-and-schedule: every
// segment must carry media, and a missing one is a 400 before auth and
// before any token is charged.
//---------------
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false, personaIds: null },
    error: null,
  })),
  engineAuthHeaders: () => ({}),
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { videoGenerate: {}, mediaUpload: {} },
}));

import { POST } from '../generate-and-schedule/route';
import { checkSemantics } from '../generate-and-schedule/request-validation';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const bodyText =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
const withMedia = [
  { kind: 'hook', text: hook, media: { url: 'https://e.com/0.jpg' } },
  { kind: 'body', text: bodyText, media: { mediaId: `${'a'.repeat(32)}.jpg` } },
  { kind: 'cta', text: cta, media: { url: 'https://e.com/2.jpg' } },
];
const bodyWithoutMedia = withMedia.map((segment, index) =>
  index === 1 ? { kind: segment.kind, text: segment.text } : segment,
);

function post(options: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('https://example.com/api/videos/generate-and-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personaId: 'persona-1',
        title: 'Porto trip',
        publishing: {
          providers: ['youtube'],
          accounts: { youtube: ['acct-1'] },
          schedule: { startAt: new Date(Date.now() + 48 * 3600_000).toISOString(), times: ['18:00'], timezone: 'Europe/Lisbon' },
        },
        options,
      }),
    }),
  );
}

function semantics(segments: unknown, facelessMaterial?: 'broll' | 'svg' | 'images') {
  return checkSemantics({
    title: 'Porto trip',
    segments,
    providers: ['youtube'],
    options: facelessMaterial === undefined ? {} : { facelessMaterial },
    personaId: 'persona-1',
  });
}

beforeEach(() => {
  vi.mocked(requireSupabaseSession).mockClear();
  vi.mocked(createSupabaseServiceClient).mockClear();
});

describe('generate-and-schedule with the images material', () => {
  it('rejects a segment without media with a 400 naming it, before auth or any charge', async () => {
    const res = await post({ segments: bodyWithoutMedia, facelessMaterial: 'images' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string; error: string };
    expect(json.field).toBe('options.segments.1.media');
    expect(json.error).toContain('the images material needs media on every segment');
    expect(requireSupabaseSession).not.toHaveBeenCalled();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('accepts media on every segment and joins the script', () => {
    const checked = semantics(withMedia, 'images');
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.options.facelessMaterial).toBe('images');
      expect(checked.value.script).toBe(`${hook}\n\n${bodyText}\n\n${cta}`);
    }
  });

  it('keeps media optional for broll, svg and an omitted material', () => {
    for (const material of ['broll', 'svg', undefined] as const) {
      expect(semantics(bodyWithoutMedia, material).ok).toBe(true);
    }
  });
});
