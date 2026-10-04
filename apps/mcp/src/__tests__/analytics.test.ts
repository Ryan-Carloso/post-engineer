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
    constructor(...args: unknown[]) {
      mockPostHogCtor(...args);
    }
  },
}));

import { trackEvent, resetAnalyticsForTesting, DEFAULT_POSTHOG_HOST } from '../analytics.js';

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

  it('captures mcp_tool_called with the tool name', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    trackEvent('mcp_tool_called', { toolName: 'generate_video' });
    // trackEvent is fire-and-forget (async lazy SDK load); wait a tick.
    await new Promise((resolve) => setImmediate(resolve));
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

  it('redacts secret-bearing property keys', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    trackEvent('mcp_tool_called', {
      toolName: 'x',
      password: 'secret123',
      apiKey: 'sk-secret',
    });
    await new Promise((resolve) => setImmediate(resolve));
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

  it('falls back to DEFAULT_POSTHOG_HOST when POSTHOG_HOST is not set', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    // undefined deletes the var and vi.unstubAllEnvs() restores the original
    // afterwards — a manual `delete` would leak into other test files.
    vi.stubEnv('POSTHOG_HOST', undefined);
    trackEvent('mcp_tool_called', { toolName: 'x' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPostHogCtor).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ host: DEFAULT_POSTHOG_HOST }),
    );
  });

  it('prefers POSTHOG_HOST over the default', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    vi.stubEnv('POSTHOG_HOST', 'https://eu.i.posthog.com');
    trackEvent('mcp_tool_called', { toolName: 'x' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPostHogCtor).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ host: 'https://eu.i.posthog.com' }),
    );
  });

  it('shares one lazy client promise across concurrent trackEvent calls', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test_key');
    // Both calls happen before the dynamic import resolves: they must wait
    // for the same in-flight promise instead of initializing twice.
    trackEvent('mcp_tool_called', { toolName: 'a' });
    trackEvent('mcp_tool_called', { toolName: 'b' });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPostHogCtor).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('warns only once when POSTHOG_API_KEY is missing', async () => {
    vi.stubEnv('POSTHOG_API_KEY', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      trackEvent('mcp_tool_called', { toolName: 'a' });
      trackEvent('mcp_tool_called', { toolName: 'b' });
      await new Promise((resolve) => setImmediate(resolve));
      const disabledWarnings = warn.mock.calls.filter((args) =>
        String(args[0]).includes('POSTHOG_API_KEY not set'),
      );
      expect(disabledWarnings).toHaveLength(1);
      expect(mockPostHogCtor).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
