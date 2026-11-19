// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// GET/PUT /api/tool-config (issue #669): auth, unconfigured shape,
// presence-only on GET and PUT, validation 400s, and
// generic 500s that never leak a raw DB message or a key value.
// Only fake keys below — never a real one.
//---------------

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { toolConfig: { name: 'tool-config', limit: 60, windowMs: 60_000 } },
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({ service: true })),
}));

vi.mock('@/lib/tool-config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/tool-config')>();
  return {
    ...original,
    getToolConfig: vi.fn(),
    saveToolConfig: vi.fn(),
  };
});

vi.mock('@/lib/api-error-reporting', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-error-reporting')>();
  return {
    ...original,
    withApiErrorReporting: (_route: string, handler: unknown) => handler,
    resolveReportingUserId: () => 'u1',
  };
});

import { GET, PUT } from '../route';
import { NextResponse as NextResponseServer } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { getToolConfig, saveToolConfig } from '@/lib/tool-config';
import { ToolConfigValidationError, ToolConfigUnreadableError } from '@/lib/tool-config';

const URL = 'http://localhost:3434/api/tool-config';

function authed() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'u1', isApiKey: false, isOAuth: false, keyId: null, personaIds: null },
    error: null,
  } as unknown as Awaited<ReturnType<typeof requireSupabaseSession>>);
}

function unauthed() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: null,
    // The route checks `ctx instanceof NextResponse`, so the error must be
    // a NextResponse like the real requireSupabaseSession returns — a plain
    // Response would slip past the check and run the handler unauthenticated.
    error: NextResponseServer.json({ success: false, error: 'Unauthorized.' }, { status: 401 }),
  } as unknown as Awaited<ReturnType<typeof requireSupabaseSession>>);
}

describe('GET /api/tool-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without a session', async () => {
    unauthed();
    const res = await GET(new Request(URL));
    expect(res.status).toBe(401);
    expect(getToolConfig).not.toHaveBeenCalled();
  });

  it('returns the unconfigured shape when the user has no row', async () => {
    authed();
    vi.mocked(getToolConfig).mockResolvedValue(null);
    const res = await GET(new Request(URL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      configured: false,
      searchTool: null,
      stockSources: [],
      keysPresent: { tavily: false, exa: false, pexels: false, pixabay: false, coverr: false },
      keysLast4: { tavily: null, exa: null, pexels: null, pixabay: null, coverr: null },
    });
  });

  it('returns presence only, never a key value', async () => {
    authed();
    vi.mocked(getToolConfig).mockResolvedValue({
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
    });
    const res = await GET(new Request(URL));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      configured: true,
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keysPresent: { tavily: true, exa: false, pexels: true, pixabay: false, coverr: false },
      keysLast4: { tavily: '1234', exa: null, pexels: '5678', pixabay: null, coverr: null },
    });
    expect(JSON.stringify(body)).not.toContain('tvly-fake-key-1234');
    expect(JSON.stringify(body)).not.toContain('pxls-fake-key-5678');
  });

  it('answers a database failure with a generic 500, never the raw message', async () => {
    authed();
    vi.mocked(getToolConfig).mockRejectedValue(new Error('relation "user_tool_configs" does not exist'));
    const res = await GET(new Request(URL));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('user_tool_configs');
  });

  it('answers an unreadable stored blob with the repair message', async () => {
    authed();
    vi.mocked(getToolConfig).mockRejectedValue(new ToolConfigUnreadableError());
    const res = await GET(new Request(URL));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('save it again');
  });
});

describe('PUT /api/tool-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without a session', async () => {
    unauthed();
    const res = await PUT(new Request(URL, { method: 'PUT', body: '{}' }));
    expect(res.status).toBe(401);
    expect(saveToolConfig).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    authed();
    const res = await PUT(new Request(URL, { method: 'PUT', body: '{not json' }));
    expect(res.status).toBe(400);
    expect(saveToolConfig).not.toHaveBeenCalled();
  });

  it('returns 400 with the field on a validation error', async () => {
    authed();
    vi.mocked(saveToolConfig).mockRejectedValue(
      new ToolConfigValidationError('searchTool', 'searchTool must be "tavily", "exa", "own", or null'),
    );
    const res = await PUT(
      new Request(URL, {
        method: 'PUT',
        body: JSON.stringify({ searchTool: 'google', stockSources: [], keys: {} }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('searchTool');
  });

  it('returns presence only, never a key value', async () => {
    authed();
    vi.mocked(saveToolConfig).mockResolvedValue({
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keysPresent: { tavily: true, exa: false, pexels: true, pixabay: false, coverr: false },
      keysLast4: { tavily: '1234', exa: null, pexels: '5678', pixabay: null, coverr: null },
    });
    const res = await PUT(
      new Request(URL, {
        method: 'PUT',
        body: JSON.stringify({
          searchTool: 'tavily',
          stockSources: ['pexels'],
          keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      configured: true,
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keysPresent: { tavily: true, exa: false, pexels: true, pixabay: false, coverr: false },
      keysLast4: { tavily: '1234', exa: null, pexels: '5678', pixabay: null, coverr: null },
    });
    expect(JSON.stringify(body)).not.toContain('tvly-fake-key-1234');
    expect(JSON.stringify(body)).not.toContain('pxls-fake-key-5678');
  });

  it('answers a database failure with a generic 500', async () => {
    authed();
    vi.mocked(saveToolConfig).mockRejectedValue(new Error('duplicate key value'));
    const res = await PUT(
      new Request(URL, {
        method: 'PUT',
        body: JSON.stringify({ searchTool: null, stockSources: [], keys: {} }),
      }),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('duplicate key value');
  });
});
