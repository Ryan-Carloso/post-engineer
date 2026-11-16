import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const captureAs = vi.hoisted(() => vi.fn());
const capture = vi.hoisted(() => vi.fn());
const getPostHogServer = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog-server', () => ({ getPostHogServer }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

import { resolveReportingUserId, withApiErrorReporting } from '@/lib/api-error-reporting';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import * as apiKeys from '@/lib/api-keys';

const CALL_ID = '0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b';

function client() {
  return { captureAs, capture, captureException: vi.fn(), captureExceptionAs: vi.fn() };
}

function mcpEvents(): Array<Record<string, unknown>> {
  return captureAs.mock.calls
    .filter((call) => call[1] === 'mcp_tool_called')
    .map((call) => call[2] as Record<string, unknown>);
}

function apiKeyRequest(): Request {
  return new Request('https://post-engineer.test/api/videos/generate-and-schedule', {
    method: 'POST',
    headers: {
      authorization: 'Bearer pe_live_1234567890abcdef1234567890abcdef',
      'x-mcp-tool': 'generate_video',
      'x-mcp-call-id': CALL_ID,
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  captureAs.mockReset();
  capture.mockReset();
  getPostHogServer.mockReset();
  getPostHogServer.mockReturnValue(client());
  vi.mocked(createSupabaseServiceClient).mockReturnValue({} as unknown as SupabaseClient);
  vi.spyOn(apiKeys, 'resolveApiKey').mockResolvedValue({
    userId: 'user-api',
    keyId: 'key-1',
    personaIds: null,
  });
});

describe('mcp_tool_called through auth and withApiErrorReporting', () => {
  function wrap(status: number) {
    return withApiErrorReporting('POST /api/videos/generate-and-schedule', async (request) => {
      const { error } = await requireSupabaseSession(request);
      if (error) return error;
      return NextResponse.json({ success: status < 400 }, { status });
    });
  }

  it('records status and ok on a successful response', async () => {
    const response = await wrap(200)(apiKeyRequest());
    expect(response.status).toBe(200);
    expect(mcpEvents()).toEqual([
      expect.objectContaining({
        tool: 'generate_video',
        call_id: CALL_ID,
        auth_method: 'api_key',
        method: 'POST',
        path: '/api/videos/generate-and-schedule',
        status: 200,
        ok: true,
      }),
    ]);
    expect(captureAs.mock.calls[0]?.[0]).toBe('user-api');
    expect(captureAs.mock.calls[0]?.[1]).toBe('mcp_tool_called');
  });

  it('records status and ok false on a 4xx response', async () => {
    const response = await wrap(409)(apiKeyRequest());
    expect(response.status).toBe(409);
    expect(mcpEvents()).toHaveLength(1);
    expect(mcpEvents()[0]).toMatchObject({ status: 409, ok: false, auth_method: 'api_key' });
  });

  it('records status 500 when the handler throws, and the error still propagates', async () => {
    const wrapped = withApiErrorReporting('POST /api/videos/generate-and-schedule', async (request) => {
      await requireSupabaseSession(request);
      throw new Error('engine down');
    });
    await expect(wrapped(apiKeyRequest())).rejects.toThrow('engine down');
    expect(mcpEvents()).toEqual([
      expect.objectContaining({ tool: 'generate_video', status: 500, ok: false, auth_method: 'api_key' }),
    ]);
  });

  it('records nothing for a cookie session, even with MCP headers', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-cookie' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'cookie-token' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    const request = new Request('https://post-engineer.test/api/persona/list', {
      headers: { 'x-mcp-tool': 'personas', 'x-mcp-action': 'list' },
    });
    const wrapped = withApiErrorReporting('GET /api/persona/list', async (incoming) => {
      const { auth, error } = await requireSupabaseSession(incoming);
      if (error || auth === null) return error ?? NextResponse.json({ success: false }, { status: 401 });
      return NextResponse.json({ success: true });
    });
    const response = await wrapped(request);
    expect(response.status).toBe(200);
    expect(mcpEvents()).toEqual([]);
  });

  it('records one event when auth runs again while the success event is reported', async () => {
    const wrapped = withApiErrorReporting(
      'POST /api/videos/generate-and-schedule',
      async (request) => {
        await requireSupabaseSession(request);
        await requireSupabaseSession(request);
        return NextResponse.json({ success: true });
      },
      { getUserId: resolveReportingUserId },
    );
    await wrapped(apiKeyRequest());
    await vi.waitFor(() => {
      expect(captureAs.mock.calls.some((call) => call[1] === 'generate_and_schedule_started')).toBe(true);
    });
    expect(mcpEvents()).toHaveLength(1);
    expect(mcpEvents()[0]).toMatchObject({ status: 200, ok: true });
  });
});
