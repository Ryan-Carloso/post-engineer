import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    generateLogId: vi.fn(() => 'test-log-id'),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

describe('POST /api/logout — auth required', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without a session', async () => {
    const client = {
      auth: { signOut: vi.fn(async () => ({ error: null })), getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it('returns 200 with a valid session', async () => {
    const client = {
      auth: { 
        signOut: vi.fn(async () => ({ error: null })), 
        getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) 
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('returns a generic 500 when sign-out fails (no internal details leaked)', async () => {
    const client = {
      auth: {
        signOut: vi.fn(async () => ({ error: { message: 'internal supabase failure detail' } })),
        getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await POST();

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to sign out.');
    expect(JSON.stringify(body)).not.toContain('internal supabase failure detail');
  });

  it('returns a generic 500 on unexpected errors (no internal details leaked)', async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error('db connection string exploded'));

    const response = await POST();

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('db connection string exploded');
  });
});
