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
const contentText =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const ctaTake = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({ url: `https://e.com/${prefix}${index}.jpg` }));
}
const withMedia = [
  { kind: 'hook', text: hook, media: photos(3, 'h') },
  { kind: 'content', text: contentText, media: [{ mediaId: `${'a'.repeat(32)}.jpg` }, ...photos(5, 'b')] },
  { kind: 'content', text: ctaTake, media: photos(2, 'c') },
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
        description: 'Agent description.',
        publishing: {
          providers: ['youtube'],
          accounts: { youtube: ['acct-1'] },
          schedule: { startAt: new Date(Date.now() + 48 * 3600_000).toISOString(), times: ['18:00'], timezone: 'Europe/Lisbon' },
        },
        options: { videoType: 'hook_lipsync', ...options },
      }),
    }),
  );
}

function semantics(segments: unknown, videoType: 'full_lipsync' | 'hook_lipsync' = 'hook_lipsync') {
  return checkSemantics({
    title: 'Porto trip',
    description: 'Agent description.',
    segments,
    providers: ['youtube'],
    options: { videoType },
    personaId: 'persona-1',
  });
}

beforeEach(() => {
  vi.mocked(requireSupabaseSession).mockClear();
  vi.mocked(createSupabaseServiceClient).mockClear();
});

describe('generate-and-schedule with the images material', () => {
  it('rejects a segment without media with a 400 naming it, before auth or any charge', async () => {
    const res = await post({ segments: bodyWithoutMedia });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string; error: string };
    expect(json.field).toBe('options.segments.1.media');
    expect(json.error).toContain('the images material needs media on every segment');
    expect(requireSupabaseSession).not.toHaveBeenCalled();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('accepts media on every segment and joins the script', () => {
    const checked = semantics(withMedia);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.script).toBe(`${hook}\n\n${contentText}\n\n${ctaTake}`);
    }
  });

  it('keeps media optional for full lip sync, required otherwise', () => {
    expect(semantics(bodyWithoutMedia, 'full_lipsync').ok).toBe(true);
    expect(semantics(bodyWithoutMedia, 'hook_lipsync').ok).toBe(false);
    expect(semantics(bodyWithoutMedia).ok).toBe(false);
  });
});
