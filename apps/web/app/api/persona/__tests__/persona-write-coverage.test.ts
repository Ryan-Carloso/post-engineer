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
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn(async () => null) };
});

import { PATCH, POST } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { restorePinnedHttp, stubPinnedHttp } from '@/test/stub-pinned-http';

const USER_ID = 'user-uuid-1';
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function png(name: string): File {
  const bytes = new Uint8Array(64);
  bytes.set(PNG_BYTES);
  return new File([bytes], name, { type: 'image/png' });
}

describe('POST/PATCH personaWrite coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyRateLimit).mockResolvedValue(null);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restorePinnedHttp();
  });

  it('returns 429 when personaWrite rejects POST', async () => {
    const limited = new Response(JSON.stringify({ success: false, errorType: 'RATE_LIMITED' }), {
      status: 429,
    });
    vi.mocked(applyRateLimit).mockResolvedValueOnce(limited as never);
    const form = new FormData();
    form.append('name', 'Ana');
    form.append('voiceId', 'voz-1');
    form.append('photo', png('main.png'));
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(429);
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.personaWrite, USER_ID);
    expect(RATE_LIMITS.personaWrite.limit).toBe(20);
  });

  it('returns 429 when personaWrite rejects PATCH', async () => {
    const limited = new Response(JSON.stringify({ success: false, errorType: 'RATE_LIMITED' }), {
      status: 429,
    });
    vi.mocked(applyRateLimit).mockResolvedValueOnce(limited as never);
    const form = new FormData();
    form.append('name', 'Nova');
    const res = await PATCH(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', { method: 'PATCH', body: form }),
    );
    expect(res.status).toBe(429);
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.personaWrite, USER_ID);
  });

  it('rolls back the ingested photo when library add fails after insert', async () => {
    const removed: string[][] = [];
    const chain = (result: unknown) => {
      const node: Record<string, ReturnType<typeof vi.fn>> = {
        select: vi.fn(),
        eq: vi.fn(),
        neq: vi.fn(),
        in: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        single: vi.fn().mockResolvedValue(result),
      };
      for (const method of ['select', 'eq', 'neq', 'in', 'insert', 'update', 'delete'] as const) {
        node[method].mockReturnThis();
      }
      return Object.assign(node, {
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      });
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'personas') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: 'persona-uuid-1' }, error: null })),
              })),
            })),
            delete: vi.fn(() => chain({ error: null })),
          };
        }
        return {
          select: vi.fn(() => chain({ count: 0, error: null })),
          insert: vi.fn(() => chain({ data: null, error: { message: 'insert boom' } })),
          delete: vi.fn(() => chain({ error: null })),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
          remove: vi.fn(async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          }),
        })),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    stubPinnedHttp(200, PNG_BYTES);
    const form = new FormData();
    form.append('name', 'Remote');
    form.append('voiceId', 'voz-1');
    form.append('avatarUrl', 'https://cdn.example/face.png');
    form.append('images', png('lib.png'));
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(500);
    expect(removed.some((paths) => paths.some((path) => path.endsWith('/photo.png')))).toBe(true);
  });

  it('removes photoPathToRollback when the persona insert fails', async () => {
    const removed: string[][] = [];
    const client = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { message: 'insert boom' } })),
          })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
          remove: vi.fn(async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          }),
        })),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    stubPinnedHttp(200, PNG_BYTES);
    const form = new FormData();
    form.append('name', 'Remote');
    form.append('voiceId', 'voz-1');
    form.append('avatarUrl', 'https://cdn.example/face.png');
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(500);
    expect(removed.some((paths) => paths.some((path) => path.endsWith('/photo.png')))).toBe(true);
  });
});
