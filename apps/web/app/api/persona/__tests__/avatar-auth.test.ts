import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from '../avatar/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

describe('POST /api/persona/avatar — auth required', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 sem sessão', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST(
      new Request('http://localhost/api/persona/avatar', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(response.status).toBe(401);
  });

  it('retorna 200 com sessão válida', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST(
      new Request('http://localhost/api/persona/avatar', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('retorna 400 quando prompt está vazio', async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST(
      new Request('http://localhost/api/persona/avatar', {
        method: 'POST',
        body: JSON.stringify({ prompt: '' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
  });
});
