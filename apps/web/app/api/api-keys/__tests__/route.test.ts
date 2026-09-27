import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, POST } from '../route';
import { DELETE } from '../[id]/route';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

describe('/api/api-keys endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/api-keys', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: null,
        error: new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 }) as unknown as NextResponse,
      });

      const request = new Request('http://localhost:3434/api/api-keys');
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('returns list of user api keys', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: { userId: 'user-1', accessToken: 'token' },
        error: null,
      });

      const mockKeys = [
        {
          id: 'key-1',
          name: 'OpenCode CLI',
          key_prefix: 'pe_live_abc12345...',
          persona_ids: null,
          created_at: '2026-09-18T10:00:00.000Z',
          last_used_at: null,
          revoked_at: null,
        },
        {
          id: 'key-2',
          name: 'Scoped Agent',
          key_prefix: 'pe_live_def67890...',
          persona_ids: ['11111111-1111-4111-8111-111111111111'],
          created_at: '2026-09-18T10:00:00.000Z',
          last_used_at: null,
          revoked_at: null,
        },
      ];

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockKeys, error: null }),
            }),
          }),
        }),
      };
      vi.mocked(createSupabaseServiceClient).mockReturnValue(mockSupabase as unknown as SupabaseClient);

      const request = new Request('http://localhost:3434/api/api-keys');
      const response = await GET(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.keys).toHaveLength(2);
      expect(data.keys[0].name).toBe('OpenCode CLI');
      expect(data.keys[0].personaIds).toBeNull();
      expect(data.keys[1].personaIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    });
  });

  describe('POST /api/api-keys', () => {
    const PERSONA_A = '11111111-1111-4111-8111-111111111111';
    const PERSONA_B = '22222222-2222-4222-8222-222222222222';

    function mockSupabaseForCreate(ownedIds: string[]) {
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'key-new-id',
              name: 'My Custom Agent',
              key_prefix: 'pe_live_12345678...',
              persona_ids: ownedIds.length > 0 ? ownedIds : null,
              created_at: '2026-09-18T10:00:00.000Z',
            },
            error: null,
          }),
        }),
      });
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'personas') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: ownedIds.map((id) => ({ id })),
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { insert };
        }),
      };
      vi.mocked(createSupabaseServiceClient).mockReturnValue(mockSupabase as unknown as SupabaseClient);
      return { mockSupabase, insert };
    }

    it('creates a new API key and returns raw key once', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: { userId: 'user-1', accessToken: 'token' },
        error: null,
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'key-new-id',
                  name: 'My Custom Agent',
                  key_prefix: 'pe_live_12345678...',
                  created_at: '2026-09-18T10:00:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.mocked(createSupabaseServiceClient).mockReturnValue(mockSupabase as unknown as SupabaseClient);

      const request = new Request('http://localhost:3434/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Custom Agent' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.key).toMatch(/^pe_live_/);
      expect(data.id).toBe('key-new-id');
      expect(data.personaIds).toBeNull();
    });

    it('creates a scoped key limited to the chosen personas', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: { userId: 'user-1', accessToken: 'token' },
        error: null,
      });
      const { insert } = mockSupabaseForCreate([PERSONA_A, PERSONA_B]);

      const request = new Request('http://localhost:3434/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Scoped Agent', personaIds: [PERSONA_A, PERSONA_B] }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.personaIds).toEqual([PERSONA_A, PERSONA_B]);
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ persona_ids: [PERSONA_A, PERSONA_B] }),
      );
    });

    it('rejects personaIds from another user', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: { userId: 'user-1', accessToken: 'token' },
        error: null,
      });
      mockSupabaseForCreate([PERSONA_A]);

      const request = new Request('http://localhost:3434/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Scoped Agent', personaIds: [PERSONA_A, PERSONA_B] }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('rejects malformed personaIds', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: { userId: 'user-1', accessToken: 'token' },
        error: null,
      });
      mockSupabaseForCreate([]);

      for (const personaIds of [['not-a-uuid'], [''], []]) {
        const request = new Request('http://localhost:3434/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Scoped Agent', personaIds }),
        });
        const response = await POST(request);
        expect(response.status).toBe(400);
      }
    });
  });

  describe('DELETE /api/api-keys/[id]', () => {
    it('revokes an existing API key', async () => {
      vi.mocked(requireSupabaseSession).mockResolvedValue({
        auth: { userId: 'user-1', accessToken: 'token' },
        error: null,
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      };
      vi.mocked(createSupabaseServiceClient).mockReturnValue(mockSupabase as unknown as SupabaseClient);

      const request = new Request('http://localhost:3434/api/api-keys/key-1', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: 'key-1' }) });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });
});

describe('API-key privilege escalation (H3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST rejects a persona-scoped API key trying to mint a new key', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: {
        userId: 'user-1',
        accessToken: 'pe_live_scoped',
        isApiKey: true,
        keyId: 'key-scoped',
        personaIds: ['11111111-1111-4111-8111-111111111111'],
      },
      error: null,
    });

    const request = new Request('http://localhost:3434/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Escalation attempt' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it('DELETE rejects a persona-scoped API key trying to revoke a sibling key', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: {
        userId: 'user-1',
        accessToken: 'pe_live_scoped',
        isApiKey: true,
        keyId: 'key-scoped',
        personaIds: ['11111111-1111-4111-8111-111111111111'],
      },
      error: null,
    });

    const request = new Request('http://localhost:3434/api/api-keys/key-other');
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'key-other' }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it('POST rejects an unrestricted API key — key management requires a full session', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: {
        userId: 'user-1',
        accessToken: 'pe_live_full',
        isApiKey: true,
        keyId: 'key-full',
        personaIds: null,
      },
      error: null,
    });

    const request = new Request('http://localhost:3434/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Via unrestricted key' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(vi.mocked(createSupabaseServiceClient)).not.toHaveBeenCalled();
  });

  it('DELETE rejects an unrestricted API key — key management requires a full session', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: {
        userId: 'user-1',
        accessToken: 'pe_live_full',
        isApiKey: true,
        keyId: 'key-full',
        personaIds: null,
      },
      error: null,
    });

    const request = new Request('http://localhost:3434/api/api-keys/key-other');
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'key-other' }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe('POST /api/api-keys rate limiting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
  });
  it('returns 429 after the apiKeyManage profile limit is exhausted', async () => {
    const { RATE_LIMITS } = await import('@/lib/rate-limit');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 }) as unknown as NextResponse,
    });
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.3',
    };
    const url = 'http://localhost:3434/api/api-keys';
    for (let i = 0; i < RATE_LIMITS.apiKeyManage.limit; i++) {
      const res = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
  });
});
