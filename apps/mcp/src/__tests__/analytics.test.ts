import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//---------------
// MCP analytics: track tool invocations as PostHog events.
//
// - trackEvent() never throws; telemetry must never break the MCP server.
// - No-op when POSTHOG_API_KEY is missing (warns once).
// - Secret-bearing property keys are redacted before capture.
// - Never logs PII, credentials, or raw request bodies.
//---------------

const mockCapture = vi.fn();
const mockPostHogCtor = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = mockCapture;
    constructor() {
      mockPostHogCtor();
    }
  },
}));

import { trackEvent, resetAnalyticsForTesting } from '../analytics.js';

describe('trackEvent', () => {
  beforeEach(() => {
    mockCapture.mockClear();
    mockPostHogCtor.mockClear();
    resetAnalyticsForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAnalyticsForTesting();
  });

  it('captures mcp_tool_called with the tool name', () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    trackEvent('mcp_tool_called', { toolName: 'generate_video' });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'mcp_tool_called',
        properties: expect.objectContaining({ toolName: 'generate_video' }),
      }),
    );
  });

  it('is a no-op when POSTHOG_API_KEY is missing', () => {
    vi.stubEnv('POSTHOG_API_KEY', '');
    expect(() => trackEvent('mcp_tool_called', { toolName: 'x' })).not.toThrow();
    expect(mockPostHogCtor).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('redacts secret-bearing property keys', () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    trackEvent('mcp_tool_called', {
      toolName: 'x',
      password: 'secret123',
      apiKey: 'sk-secret',
    });
    const call = mockCapture.mock.calls[0][0] as {
      properties: Record<string, unknown>;
    };
    const text = JSON.stringify(call.properties);
    expect(text).not.toContain('secret123');
    expect(text).not.toContain('sk-secret');
    expect(call.properties['password']).toBe('[redacted]');
  });

  it('never throws when PostHog capture fails', () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    mockCapture.mockImplementation(() => {
      throw new Error('posthog down');
    });
    expect(() => trackEvent('mcp_tool_called', { toolName: 'x' })).not.toThrow();
  });

  it('never throws when PostHog constructor fails', () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    mockPostHogCtor.mockImplementationOnce(() => {
      throw new Error('init failed');
    });
    expect(() => trackEvent('mcp_tool_called', { toolName: 'x' })).not.toThrow();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
