import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureAs = vi.hoisted(() => vi.fn());
const getPostHogServer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog-server', () => ({ getPostHogServer }));

import { trackMcpToolCall } from '../mcp-tool-telemetry';

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
      'x-mcp-tool': 'list_personas',
      'x-mcp-call-id': CALL_ID,
      'x-mcp-version': '1.42.0',
    });
    trackMcpToolCall(request, 'user-1', 'api_key');
    expect(captureAs).toHaveBeenCalledTimes(1);
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', {
      tool: 'list_personas',
      call_id: CALL_ID,
      mcp_version: '1.42.0',
      auth_method: 'api_key',
      method: 'GET',
      // The query string never reaches telemetry.
      path: '/api/persona/list',
    });
  });

  it.each([
    ['a percent-encoded Bearer token', '/api/prompts/Bearer%20abc123secret'],
    ['an API key', '/api/prompts/pe_live_1234567890abcdef'],
    ['a uuid', '/api/persona/video-status/0b9f6a52-2f43-4c8e-9a51-6f0d1c2e3a4b'],
    ['a malformed percent-encoding', '/api/prompts/%E0%A4%A'],
  ])('replaces a dynamic path segment carrying %s with :param', (_label, path) => {
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'get_prompt' }, `https://post-engineer.test${path}`), 'user-1', 'api_key');
    const properties = captureAs.mock.calls[0]?.[2] as Record<string, unknown>;
    const expected = path.slice(0, path.lastIndexOf('/') + 1) + ':param';
    expect(properties.path).toBe(expected);
    expect(JSON.stringify(properties)).not.toContain(path.slice(path.lastIndexOf('/') + 1));
  });

  it('redacts a credential that looks like a static segment (scrubber layer)', () => {
    trackMcpToolCall(
      mcpRequest({ 'x-mcp-tool': 'get_prompt' }, 'https://post-engineer.test/api/prompts/sk-abcdefghijklmnopqrstuvwxyz'),
      'user-1',
      'api_key',
    );
    expect(captureAs.mock.calls[0]?.[2]).toMatchObject({ path: '/api/prompts/[redacted]' });
  });

  it('keeps a static slug segment readable', () => {
    trackMcpToolCall(
      mcpRequest({ 'x-mcp-tool': 'get_prompt' }, 'https://post-engineer.test/api/prompts/daily-news'),
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
      mcpRequest({ 'x-mcp-tool': 'get_prompt', 'x-mcp-call-id': 'not-a-uuid', 'x-mcp-version': 'latest' }),
      'user-1',
      'oauth',
    );
    expect(captureAs).toHaveBeenCalledWith('user-1', 'mcp_tool_called', {
      tool: 'get_prompt',
      auth_method: 'oauth',
      method: 'GET',
      path: '/api/persona/list',
    });
  });

  it('records one event per request even when auth runs twice for it', () => {
    const request = mcpRequest({ 'x-mcp-tool': 'list_personas' });
    trackMcpToolCall(request, 'user-1', 'api_key');
    trackMcpToolCall(request, 'user-1', 'api_key');
    expect(captureAs).toHaveBeenCalledTimes(1);
    trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'list_personas' }), 'user-1', 'api_key');
    expect(captureAs).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when PostHog is not configured', () => {
    getPostHogServer.mockReturnValue(null);
    expect(() => trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'list_personas' }), 'user-1', 'api_key')).not.toThrow();
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('never throws when the capture itself throws', () => {
    captureAs.mockImplementation(() => {
      throw new Error('posthog down');
    });
    expect(() => trackMcpToolCall(mcpRequest({ 'x-mcp-tool': 'list_personas' }), 'user-1', 'api_key')).not.toThrow();
    expect(captureAs).toHaveBeenCalledTimes(1);
  });
});
