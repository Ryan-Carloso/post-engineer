import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureAs = vi.hoisted(() => vi.fn());
const getPostHogServer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog-server', () => ({ getPostHogServer }));

import { trackMcpToolCall } from '../mcp-tool-telemetry';
import { PROMPTS } from '@/app/recipes/prompts';

const CALL_ID = '0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b';

function mcpRequest(headers: Record<string, string>, url = 'https://post-engineer.test/api/persona/list?limit=5'): Request {
  return new Request(url, { method: 'GET', headers });
}

describe('trackMcpToolCall', () => {
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
    trackMcpToolCall(request, 'user-1', 'api_key');
    expect(captureAs).toHaveBeenCalledTimes(1);
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', {
      tool: 'personas',
      call_id: CALL_ID,
      mcp_version: '1.42.0',
      auth_method: 'api_key',
      method: 'GET',
      // The query string never reaches telemetry.
      path: '/api/persona/list',
    });
  });

  it('records the action of an action tool next to the tool name, and ignores a malformed one', () => {
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'personas', 'x-mcp-action': 'create' }), 'user-1', 'api_key');
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ tool: 'personas', action: 'create' });
    captureAs.mockReset();
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'personas', 'x-mcp-action': 'Create; DROP' }), 'user-1', 'api_key');
    expect(captureAs.mock.calls[0]?.[2]).not.toHaveProperty('action');
  });

  it('records no action for a tool without actions', () => {
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'generate_video' }), 'user-1', 'api_key');
    expect(captureAs.mock.calls[0]?.[2]).not.toHaveProperty('action');
  });

  it.each([
    ['a percent-encoded Bearer token', '/api/prompts/Bearer%20abc123secret'],
    ['an API key', '/api/prompts/pe_live_1234567890abcdef'],
    ['a uuid', '/api/persona/video-status/0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b'],
    ['a letter-initial uuid', '/api/persona/video-status/a1b2c3d4-2f43-4c8e-9a51-6f0d1c2e3a4b'],
    ['a malformed percent-encoding', '/api/prompts/%E0%A4%A'],
  ])('replaces a dynamic path segment carrying %s with :param', (_label, path) => {
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'prompts' }, `https://post-engineer.test${path}`), 'user-1', 'api_key');
    const properties = captureAs.mock.calls[0]?.[2] as Record<string, unknown>;
    const expected = path.slice(0, path.lastIndexOf('/') + 1) + ':param';
    expect(properties.path).toBe(expected);
    expect(JSON.stringify(properties)).not.toContain(path.slice(path.lastIndexOf('/') + 1));
  });

  it('redacts a credential that looks like a static segment (scrubber layer)', () => {
    trackMcpToolCall(
      mcpRequest({ 'x-mcp-tool': 'prompts' }, 'https://post-engineer.test/api/prompts/sk-abcdefghijklmnopqrstuvwxyz'),
      'user-1',
      'api_key',
    );
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ path: '/api/prompts/[redacted]' });
  });

  it('keeps a static slug segment readable', () => {
    trackMcpToolCall(
      mcpRequest({ 'x-mcp-tool': 'prompts' }, 'https://post-engineer.test/api/prompts/daily-news'),
      'user-1',
      'api_key',
    );
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ path: '/api/prompts/daily-news' });
  });

  it('records nothing without the tool header', () => {
    trackMcpToolCall(mcpRequest({ 'x-mcp-version': '1.42.0' }), 'user-1', 'oauth');
    expect(captureAs).not.toHaveBeenCalled();
  });

  it.each([
    ['uppercase', 'List_Personas'],
    ['a space', 'list personas'],
    ['a leading digit', '1_tool'],
    ['over 64 chars', `a${'b'.repeat(64)}`],
    ['an empty value', ''],
  ])('records nothing for a tool header with %s', (_label, tool) => {
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': tool }), 'user-1', 'api_key');
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('drops a malformed call id or version but still records the tool', () => {
    trackMcpToolCall(
      mcpRequest({ 'x-mcp-tool': 'prompts', 'x-mcp-call-id': 'not-a-uuid', 'x-mcp-version': 'latest' }),
      'user-1',
      'oauth',
    );
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', {
      tool: 'prompts',
      auth_method: 'oauth',
      method: 'GET',
      path: '/api/persona/list',
    });
  });

  it('records one event per request even when auth runs twice for it', () => {
    const request = mcpRequest({ 'x-mcp-tool': 'personas' });
    trackMcpToolCall(request, 'user-1', 'api_key');
    trackMcpToolCall(request, 'user-1', 'api_key');
    expect(captureAs).toHaveBeenCalledTimes(1);
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'personas' }), 'user-1', 'api_key');
    expect(captureAs).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when PostHog is not configured', () => {
    getPostHogServer.mockReturnValue(null);
    expect(() => trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'personas' }), 'user-1', 'api_key')).not.toThrow();
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('never throws when the capture itself throws', () => {
    captureAs.mockImplementation(() => {
      throw new Error('posthog down');
    });
    expect(() => trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'personas' }), 'user-1', 'api_key')).not.toThrow();
    expect(captureAs).toHaveBeenCalledTimes(1);
  });

  describe('recipe-adoption headers', () => {
    const SESSION_ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
    const hubSlug = PROMPTS[0]?.slug ?? '';

    function recordedProperties(headers: Record<string, string>): Record<string, unknown> {
      trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'generate_video', ...headers }), 'user-1', 'api_key');
      return captureAs.mock.calls[0]?.[2] as Record<string, unknown>;
    }

    it('records the session, attribution and recipe headers as typed properties', () => {
      expect(hubSlug.length).toBeGreaterThan(0);
      const properties = recordedProperties({
        'x-mcp-session-id': SESSION_ID,
        'x-mcp-transport': 'stdio',
        'x-mcp-nudged-by': 'personas_list',
        'x-mcp-recipes-known': 'true',
        'x-mcp-recipe-fetched': hubSlug,
        'x-mcp-script-rejections': '2',
        'x-mcp-recipe': hubSlug,
      });
      expect(properties).toMatchObject({
        session_id: SESSION_ID,
        transport: 'stdio',
        nudged_by: 'personas_list',
        recipes_known: true,
        recipe_fetched: hubSlug,
        script_rejections: 2,
        recipe: hubSlug,
      });
    });

    it('records a recipe that is not a hub slug as unknown, never the caller text', () => {
      const properties = recordedProperties({
        'x-mcp-recipe': 'pe-live-secret-slug',
        'x-mcp-recipe-fetched': 'another-made-up-slug',
      });
      expect(properties.recipe).toBe('unknown');
      expect(properties.recipe_fetched).toBe('unknown');
      expect(JSON.stringify(properties)).not.toContain('secret-slug');
      expect(JSON.stringify(properties)).not.toContain('made-up-slug');
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
      const properties = recordedProperties({ 'x-mcp-recipe': hubSlug });
      expect(properties).toMatchObject({ tool: 'generate_video', auth_method: 'api_key', path: '/api/persona/list' });
    });
  });
});
