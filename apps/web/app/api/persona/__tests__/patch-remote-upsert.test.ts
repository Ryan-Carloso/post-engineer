// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '1.2.3.4' }]),
}));

import { PATCH } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { restorePinnedHttp, stubPinnedHttp } from '@/test/stub-pinned-http';

const USER_ID = 'user-uuid-1';
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describe('PATCH remote ingest onto an existing photo object', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restorePinnedHttp();
  });

  function patchClient(existing: Record<string, unknown>, updateError: { message: string } | null = null) {
    const uploaded: Array<{ path: string; upsert?: boolean }> = [];
    const removeMock = vi.fn(async () => ({ error: null }));
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      },
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string, _body: unknown, options: { upsert?: boolean }) => {
            uploaded.push({ path, upsert: options?.upsert });
            return { data: { path }, error: null };
          }),
          remove: removeMock,
        })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: existing, error: null })),
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: updateError })),
        })),
      })),
    };
    return { client, uploaded, removeMock };
  }

  function stubPng() {
    stubPinnedHttp(200, PNG_BYTES);
  }

  it('uploads a temp object instead of overwriting the live photo.png', async () => {
    const existing = {
      id: 'persona-uuid-1',
      user_id: USER_ID,
      name: 'Antiga',
      photo_path: `${USER_ID}/persona-uuid-1/photo.png`,
      avatar_url: null,
      voice_id: 'voz-antiga',
      voice_audio_path: null,
    };
    const { client, uploaded, removeMock } = patchClient(existing);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    });
    stubPng();
    const formData = new FormData();
    formData.append('avatarUrl', 'https://cdn.example/face.png');
    const res = await PATCH(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', {
        method: 'PATCH',
        body: formData,
      }),
    );
    expect(res.status).toBe(200);
    expect(uploaded[0]?.path).toMatch(new RegExp(`^${USER_ID}/persona-uuid-1/ingest/.+\\.png$`));
    expect(uploaded[0]?.upsert).toBe(false);
    expect(removeMock).toHaveBeenCalledWith([`${USER_ID}/persona-uuid-1/photo.png`]);
  });

  it('keeps the previous photo when the row update fails after upload', async () => {
    const live = `${USER_ID}/persona-uuid-1/photo.png`;
    const existing = {
      id: 'persona-uuid-1',
      user_id: USER_ID,
      name: 'Antiga',
      photo_path: live,
      avatar_url: null,
      voice_id: 'voz-antiga',
      voice_audio_path: null,
    };
    const { client, uploaded, removeMock } = patchClient(existing, { message: 'constraint' });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    });
    stubPng();
    const formData = new FormData();
    formData.append('avatarUrl', 'https://cdn.example/face.png');
    const res = await PATCH(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', {
        method: 'PATCH',
        body: formData,
      }),
    );
    expect(res.status).toBe(500);
    expect(uploaded[0]?.path).toMatch(new RegExp(`^${USER_ID}/persona-uuid-1/ingest/.+\\.png$`));
    expect(removeMock).toHaveBeenCalledWith([uploaded[0]?.path]);
    expect(removeMock).not.toHaveBeenCalledWith([live]);
  });

  it('removes a different existing photo_path after a remote ingest', async () => {
    const existing = {
      id: 'persona-uuid-1',
      user_id: USER_ID,
      name: 'Antiga',
      photo_path: `${USER_ID}/persona-uuid-1/photo.jpg`,
      avatar_url: null,
      voice_id: 'voz-antiga',
      voice_audio_path: null,
    };
    const { client, removeMock } = patchClient(existing);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    });
    stubPng();
    const formData = new FormData();
    formData.append('avatarUrl', 'https://cdn.example/face.png');
    const res = await PATCH(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', {
        method: 'PATCH',
        body: formData,
      }),
    );
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([`${USER_ID}/persona-uuid-1/photo.jpg`]);
  });
});
