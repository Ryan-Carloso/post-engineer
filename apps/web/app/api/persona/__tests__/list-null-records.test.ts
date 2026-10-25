import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { GET } from '../list/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const USER_ID = 'user-uuid-1';

describe('GET /api/persona/list null records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'token' },
      error: null,
    });
  });

  it('treats a null personas payload without an error as an empty list', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'persona_images') {
        throw new Error('persona_images must not run when records are empty');
      }
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: null, error: null }),
          }),
        }),
      };
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from,
      storage: { from: vi.fn() },
    } as never);

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { authenticated: boolean; personas: unknown[] };
    expect(res.status).toBe(200);
    expect(body.personas).toEqual([]);
    expect(from.mock.calls.map((call) => call[0])).not.toContain('persona_images');
  });

  it('treats an undefined personas payload without an error as an empty list', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            order: async () => ({ data: undefined, error: null }),
          }),
        }),
      })),
      storage: { from: vi.fn() },
    } as never);

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: unknown[] };
    expect(res.status).toBe(200);
    expect(body.personas).toEqual([]);
  });

  it('omits libraryUrl when createSignedUrl returns undefined data', async () => {
    const libraryPath = `${USER_ID}/p-1/library.png`;
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'persona_images') {
          return {
            select: () => ({
              in: () => ({
                eq: async () => ({
                  data: [
                    {
                      id: 'img-1',
                      persona_id: 'p-1',
                      image_path: libraryPath,
                      is_primary: true,
                      created_at: '2026-01-01T00:00:00Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    id: 'p-1',
                    name: 'Ana',
                    photo_path: null,
                    avatar_url: null,
                    voice_id: null,
                    voice_audio_path: null,
                    created_at: '2026-08-29T00:00:00Z',
                    language: null,
                    video_aspect: null,
                    video_layout: null,
                    script_prompt: null,
                    cta_text: null,
                    paragraph_number: null,
                    niche: null,
                    face_quality: null,
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: undefined, error: null }),
        }),
      },
    } as never);

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ libraryUrl?: string }> };
    expect(res.status).toBe(200);
    expect(body.personas[0].libraryUrl).toBeUndefined();
  });
});
