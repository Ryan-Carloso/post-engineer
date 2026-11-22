import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureAs = vi.hoisted(() => vi.fn());
const getPostHogServer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog-server', () => ({ getPostHogServer }));

import { noteMcpToolCaller, recordMcpToolCall } from '../mcp-tool-telemetry';

const CALL_ID = '0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b';

function mcpRequest(headers: Record<string, string>, url = 'https://post-engineer.test/api/persona/list?limit=5'): Request {
  return new Request(url, { method: 'GET', headers });
}

function record(request: Request, auth: 'api_key' | 'oauth' = 'api_key', status = 200): void {
  noteMcpToolCaller(request, 'user-1', auth);
  recordMcpToolCall(request, status);
}

describe('mcp_tool_called', () => {
  beforeEach(() => {
    captureAs.mockReset();
    getPostHogServer.mockReset();
    getPostHogServer.mockReturnValue({ captureAs });
  });

  it('records mcp_tool_called against the user with tool, call id, version, auth method and path', () => {
    const request = mcpRequest({
      'x-mcp-tool': 'personas',
      'x-mcp-call-id': CALL_ID,
      'x-mcp-version': '1.42.0',
    });
    record(request);
    expect(captureAs).toHaveBeenCalledTimes(1);
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', {
      tool: 'personas',
      call_id: CALL_ID,
      mcp_version: '1.42.0',
      auth_method: 'api_key',
      method: 'GET',
      path: '/api/persona/list',
      status: 200,
      ok: true,
    });
  });

  it('records the action of an action tool next to the tool name, and ignores a malformed one', () => {
    record(mcpRequest({ 'x-mcp-tool': 'personas', 'x-mcp-action': 'create' }));
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ tool: 'personas', action: 'create' });
    captureAs.mockReset();
    record(mcpRequest({ 'x-mcp-tool': 'personas', 'x-mcp-action': 'Create; DROP' }));
    expect(captureAs.mock.calls[0]?.[2]).not.toHaveProperty('action');
  });

  it('records no action for a tool without actions', () => {
    record(mcpRequest({ 'x-mcp-tool': 'generate_video' }));
    expect(captureAs.mock.calls[0]?.[2]).not.toHaveProperty('action');
  });

  it.each([
    ['a percent-encoded Bearer token', '/api/prompts/Bearer%20abc123secret'],
    ['an API key', '/api/prompts/pe_live_1234567890abcdef'],
    ['a uuid', '/api/persona/video-status/0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b'],
    ['a letter-initial uuid', '/api/persona/video-status/a1b2c3d4-2f43-4c8e-9a51-6f0d1c2e3a4b'],
    ['a malformed percent-encoding', '/api/prompts/%E0%A4%A'],
  ])('replaces a dynamic path segment carrying %s with :param', (_label, path) => {
    record(mcpRequest({ 'x-mcp-tool': 'prompts' }, `https://post-engineer.test${path}`));
    const properties = captureAs.mock.calls[0]?.[2] as Record<string, unknown>;
    const expected = path.slice(0, path.lastIndexOf('/') + 1) + ':param';
    expect(properties.path).toBe(expected);
    expect(JSON.stringify(properties)).not.toContain(path.slice(path.lastIndexOf('/') + 1));
  });

  it('redacts a credential that looks like a static segment (scrubber layer)', () => {
    record(
      mcpRequest({ 'x-mcp-tool': 'prompts' }, 'https://post-engineer.test/api/prompts/sk-abcdefghijklmnopqrstuvwxyz')
    );
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ path: '/api/prompts/[redacted]' });
  });

  it('keeps a static slug segment readable', () => {
    record(
      mcpRequest({ 'x-mcp-tool': 'prompts' }, 'https://post-engineer.test/api/prompts/daily-news')
    );
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ path: '/api/prompts/daily-news' });
  });

  it('records nothing without the tool header', () => {
    record(mcpRequest({ 'x-mcp-version': '1.42.0' }), 'oauth');
    expect(captureAs).not.toHaveBeenCalled();
  });

  it.each([
    ['uppercase', 'List_Personas'],
    ['a space', 'list personas'],
    ['a leading digit', '1_tool'],
    ['over 64 chars', `a${'b'.repeat(64)}`],
    ['an empty value', ''],
  ])('records nothing for a tool header with %s', (_label, tool) => {
    record(mcpRequest({ 'x-mcp-tool': tool }));
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('drops a malformed call id or version but still records the tool', () => {
    record(
      mcpRequest({ 'x-mcp-tool': 'prompts', 'x-mcp-call-id': 'not-a-uuid', 'x-mcp-version': 'latest' }),
      'oauth',
    );
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', {
      tool: 'prompts',
      auth_method: 'oauth',
      method: 'GET',
      path: '/api/persona/list',
      status: 200,
      ok: true,
    });
  });

  it('records status and ok false on a 4xx and on a 500', () => {
    record(mcpRequest({ 'x-mcp-tool': 'personas' }), 'api_key', 409);
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ status: 409, ok: false, tool: 'personas' });
    captureAs.mockReset();
    record(mcpRequest({ 'x-mcp-tool': 'personas' }), 'api_key', 500);
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ status: 500, ok: false });
  });

  it('records nothing when the caller was never noted', () => {
    recordMcpToolCall(mcpRequest({ 'x-mcp-tool': 'personas' }), 200);
    recordMcpToolCall(undefined, 500);
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('records one event per request even when auth runs twice for it', () => {
    const request = mcpRequest({ 'x-mcp-tool': 'personas' });
    noteMcpToolCaller(request, 'user-1', 'api_key');
    noteMcpToolCaller(request, 'other-user', 'oauth');
    recordMcpToolCall(request, 200);
    recordMcpToolCall(request, 500);
    expect(captureAs).toHaveBeenCalledTimes(1);
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', expect.objectContaining({
      auth_method: 'api_key',
      status: 200,
      ok: true,
    }));
    record(mcpRequest({ 'x-mcp-tool': 'personas' }));
    expect(captureAs).toHaveBeenCalledTimes(2);
  });

  describe('one mcp_tool_called per tool call', () => {
    function callRequest(ordinal: string): Request {
      return mcpRequest(
        { 'x-mcp-tool': 'video_tasks', 'x-mcp-action': 'status', 'x-mcp-call-id': CALL_ID, 'x-mcp-call-request': ordinal },
        'https://post-engineer.test/api/persona/video-status/0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b',
      );
    }

    it('records a wait with several status requests as one mcp_tool_called', () => {
      for (const ordinal of ['1', '2', '3', '4', '5']) record(callRequest(ordinal));
      expect(captureAs).toHaveBeenCalledTimes(1);
      expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', expect.objectContaining({
        tool: 'video_tasks',
        action: 'status',
        call_id: CALL_ID,
        path: '/api/persona/video-status/:param',
        status: 200,
        ok: true,
      }));
      expect(captureAs.mock.calls[0]?.[2]).not.toHaveProperty('call_request');
    });

    it('records a failed follow-up request as mcp_tool_request_failed with its ordinal', () => {
      record(callRequest('1'));
      record(callRequest('2'), 'api_key', 502);
      record(callRequest('3'), 'api_key', 404);
      expect(captureAs.mock.calls.map((call) => call[1])).toEqual([
        'mcp_tool_called',
        'mcp_tool_request_failed',
        'mcp_tool_request_failed',
      ]);
      expect(captureAs.mock.calls[1]?.[2]).toMatchObject({ call_id: CALL_ID, status: 502, ok: false, call_request: 2 });
      expect(captureAs.mock.calls[2]?.[2]).toMatchObject({ call_id: CALL_ID, status: 404, ok: false, call_request: 3 });
    });

    it('records a failed first request as mcp_tool_called with ok false', () => {
      record(callRequest('1'), 'api_key', 500);
      expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', expect.objectContaining({ status: 500, ok: false }));
    });

    it.each([['0'], ['01'], ['-2'], ['two'], ['1234567']])('treats a malformed ordinal %s as the first request', (ordinal) => {
      record(callRequest(ordinal));
      expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', expect.objectContaining({ tool: 'video_tasks' }));
    });
  });

  it('is a no-op when PostHog is not configured', () => {
    getPostHogServer.mockReturnValue(null);
    expect(() => record(mcpRequest({ 'x-mcp-tool': 'personas' }))).not.toThrow();
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('never throws when the capture itself throws', () => {
    captureAs.mockImplementation(() => {
      throw new Error('posthog down');
    });
    expect(() => record(mcpRequest({ 'x-mcp-tool': 'personas' }))).not.toThrow();
    expect(captureAs).toHaveBeenCalledTimes(1);
  });

  describe('recipe-adoption headers', () => {
    const SESSION_ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
    const promptSlug = 'daily-news';

    function recordedProperties(headers: Record<string, string>): Record<string, unknown> {
      record(mcpRequest({ 'x-mcp-tool': 'generate_video', ...headers }));
      return captureAs.mock.calls[0]?.[2] as Record<string, unknown>;
    }

    it('records the session, attribution and recipe headers as typed properties, never the prompt slug', () => {
      const properties = recordedProperties({
        'x-mcp-session-id': SESSION_ID,
        'x-mcp-transport': 'stdio',
        'x-mcp-nudged-by': 'personas_list',
        'x-mcp-recipes-known': 'true',
        'x-mcp-recipe-fetched': promptSlug,
        'x-mcp-script-rejections': '2',
        'x-mcp-recipe': promptSlug,
      });
      expect(properties).toMatchObject({
        session_id: SESSION_ID,
        transport: 'stdio',
        nudged_by: 'personas_list',
        recipes_known: true,
        recipe_fetched: 'prompt',
        script_rejections: 2,
        recipe: 'prompt',
      });
      expect(JSON.stringify(properties)).not.toContain(promptSlug);
    });

    it('records a slug-shaped recipe as a followed prompt, never the caller text', () => {
      const properties = recordedProperties({
        'x-mcp-recipe': 'pe-live-secret-slug',
        'x-mcp-recipe-fetched': 'another-made-up-slug',
      });
      expect(properties.recipe).toBe('prompt');
      expect(properties.recipe_fetched).toBe('prompt');
      expect(JSON.stringify(properties)).not.toContain('secret-slug');
      expect(JSON.stringify(properties)).not.toContain('made-up-slug');
    });

    it('records a recipe that is not a slug as unknown, never the caller text', () => {
      const properties = recordedProperties({ 'x-mcp-recipe': 'Not A Slug!', 'x-mcp-recipe-fetched': 'UPPER' });
      expect(properties.recipe).toBe('unknown');
      expect(properties.recipe_fetched).toBe('unknown');
      expect(JSON.stringify(properties)).not.toContain('Not A Slug');
    });

    it('accepts none for the fetched recipe but not for the declared one', () => {
      const properties = recordedProperties({ 'x-mcp-recipe-fetched': 'none', 'x-mcp-recipe': 'none' });
      expect(properties.recipe_fetched).toBe('none');
      expect(properties.recipe).toBe('unknown');
    });

    it('drops malformed session, transport, surface, boolean and counter values', () => {
      const properties = recordedProperties({
        'x-mcp-session-id': 'not-a-uuid',
        'x-mcp-transport': 'carrier-pigeon',
        'x-mcp-nudged-by': 'some_other_tool',
        'x-mcp-recipes-known': 'yes',
        'x-mcp-script-rejections': '10000',
      });
      for (const key of ['session_id', 'transport', 'nudged_by', 'recipes_known', 'script_rejections']) {
        expect(properties).not.toHaveProperty(key);
      }
      expect(properties.tool).toBe('generate_video');
    });

    it('records recipes_known false as a boolean', () => {
      expect(recordedProperties({ 'x-mcp-recipes-known': 'false' }).recipes_known).toBe(false);
    });

    it('lets no recipe header override the tool, path or auth method', () => {
      const properties = recordedProperties({ 'x-mcp-recipe': promptSlug });
      expect(properties).toMatchObject({ tool: 'generate_video', auth_method: 'api_key', path: '/api/persona/list' });
    });
  });
});
