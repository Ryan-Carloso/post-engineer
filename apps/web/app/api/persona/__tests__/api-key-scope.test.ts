import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Persona scope per API key: a restricted key only accesses the personas
// chosen at creation. Auth and Supabase are mocked boundaries; the access
// control (403 + .in filter) is real.
//---------------

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));



import { requireSupabaseSession } from '@/lib/request-auth';
import { GET as listPersonas } from '../list/route';
import { POST as createPersona, PATCH as patchPersona, DELETE as deletePersona } from '../route';

const USER_ID = 'user-1';
const ALLOWED_ID = '11111111-1111-4111-8111-111111111111';
const DENIED_ID = '22222222-2222-4222-8222-222222222222';

function mockScopedAuth(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: {
      userId: USER_ID,
      accessToken: 'pe_live_scoped',
      isApiKey: true,
      keyId: 'key-1',
      personaIds: [ALLOWED_ID],
    },
    error: null,
  });
}

function mockFullAccessAuth(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_live_full', isApiKey: true, keyId: 'key-2', personaIds: null },
    error: null,
  });
}

describe('persona scope enforcement for scoped api keys', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks persona creation with a scoped key', async () => {
    mockScopedAuth();
    const formData = new FormData();
    formData.set('name', 'New');
    const request = new Request('http://localhost:3434/api/persona', {
      method: 'POST',
      body: formData,
    });
    const response = await createPersona(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it('blocks persona update for personas outside the scope', async () => {
    mockScopedAuth();
    const formData = new FormData();
    formData.set('name', 'Renamed');
    const request = new Request(`http://localhost:3434/api/persona?personaId=${DENIED_ID}`, {
      method: 'PATCH',
      body: formData,
    });
    const response = await patchPersona(request);
    expect(response.status).toBe(403);
  });

  it('blocks persona deletion for personas outside the scope', async () => {
    mockScopedAuth();
    const request = new Request(`http://localhost:3434/api/persona?personaId=${DENIED_ID}`, {
      method: 'DELETE',
    });
    const response = await deletePersona(request);
    expect(response.status).toBe(403);
  });

  it('lists only scoped personas for restricted keys', async () => {
    mockScopedAuth();
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const inFilter = vi.fn().mockReturnValue({ order });
    const eqFilter = vi.fn().mockReturnValue({ order, in: inFilter });
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFilter }),
      }),
      storage: { from: vi.fn() },
    } as never);

    const request = new Request('http://localhost:3434/api/persona/list');
    const response = await listPersonas(request);
    expect(response.status).toBe(200);
    expect(inFilter).toHaveBeenCalledWith('id', [ALLOWED_ID]);
  });

  it('lists all personas for unrestricted keys', async () => {
    mockFullAccessAuth();
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const inFilter = vi.fn().mockReturnValue({ order });
    const eqFilter = vi.fn().mockReturnValue({ order, in: inFilter });
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFilter }),
      }),
      storage: { from: vi.fn() },
    } as never);

    const request = new Request('http://localhost:3434/api/persona/list');
    const response = await listPersonas(request);
    expect(response.status).toBe(200);
    expect(inFilter).not.toHaveBeenCalled();
  });
});
