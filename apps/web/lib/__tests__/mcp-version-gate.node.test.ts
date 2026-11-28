import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findRepoRoot } from '@/test/repo-root';
import { withApiErrorReporting } from '../api-error-reporting';
import { getPostHogServer } from '../posthog-server';
import {
  checkMcpVersion as liveGate,
  createMcpVersionGate,
  MCP_VERSION_HEADER,
  MISMATCH_WARNING_WINDOW_MS,
} from '../mcp-version-gate';

const warn = vi.hoisted(() => vi.fn(() => 'log-id-1'));
vi.mock('../logger', () => ({
  logger: { warn, error: vi.fn(() => 'log-id-2'), info: vi.fn(), generateLogId: vi.fn() },
}));
vi.mock('../posthog-server', () => ({ getPostHogServer: vi.fn() }));
vi.mock('../request-auth', () => ({ requireSupabaseSession: vi.fn() }));

let currentTime = 0;
let checkMcpVersion: (request: Request) => Response | null;

function loggedMessages(): unknown[] {
  return warn.mock.calls.map((call) => (call as unknown[])[0]);
}

function loggedVersions(): unknown[] {
  return warn.mock.calls.map((call) => ((call as unknown[])[1] as Record<string, unknown>).clientVersion);
}

function mcpRequest(version?: string): Request {
  const headers: Record<string, string> = { authorization: 'Bearer pe_live_x' };
  if (version !== undefined) headers[MCP_VERSION_HEADER] = version;
  return new Request('http://localhost:3434/api/account', { headers });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('checkMcpVersion', () => {
  beforeEach(() => {
    currentTime = 1_000_000;
    checkMcpVersion = createMcpVersionGate({ now: () => currentTime });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockClear();
  });

  it('lets a request without the MCP version header through without reading the env', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', undefined);
    expect(checkMcpVersion(mcpRequest())).toBeNull();
  });

  it('lets the exact required version through', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    expect(checkMcpVersion(mcpRequest('1.52.560'))).toBeNull();
  });

  it('rejects an older MCP with 426 and the exact npx command', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    const response = checkMcpVersion(mcpRequest('1.52.0'));
    expect(response?.status).toBe(426);
    const json = await body(response as Response);
    expect(json.success).toBe(false);
    expect(json.code).toBe('MCP_VERSION_MISMATCH');
    expect(json.requiredVersion).toBe('1.52.560');
    expect(json.error).toBe(
      'post-engineer-mcp 1.52.0 is out of date: this server requires 1.52.560. ' +
        'Restart the MCP with npx -y post-engineer-mcp@1.52.560.',
    );
  });

  it('rejects a newer MCP with 426 and says a deploy is in progress', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    const response = checkMcpVersion(mcpRequest('1.52.561'));
    expect(response?.status).toBe(426);
    const json = await body(response as Response);
    expect(json.error).toBe(
      'post-engineer-mcp 1.52.561 is newer than this server, which requires 1.52.560: a deploy is in progress. ' +
        'Retry in a few minutes, or restart the MCP with npx -y post-engineer-mcp@1.52.560.',
    );
  });

  it('compares versions numerically, not as text', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.100');
    const response = checkMcpVersion(mcpRequest('1.52.99'));
    const json = await body(response as Response);
    expect(String(json.error)).toContain('is out of date');
  });

  it('never echoes a malformed version header back', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    const response = checkMcpVersion(mcpRequest('<script>'));
    expect(response?.status).toBe(426);
    const json = await body(response as Response);
    expect(json.error).toBe(
      'This post-engineer-mcp version is not supported: this server requires 1.52.560. ' +
        'Restart the MCP with npx -y post-engineer-mcp@1.52.560.',
    );
    expect(JSON.stringify(json)).not.toContain('<script>');
  });

  it('logs each new mismatch under one stable message', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    checkMcpVersion(mcpRequest('1.52.0'));
    checkMcpVersion(mcpRequest('1.52.561'));
    expect(loggedMessages()).toEqual([
      '[mcp-version-gate] 426 MCP version mismatch',
      '[mcp-version-gate] 426 MCP version mismatch',
    ]);
  });

  it('rejects every call from a stale client but warns only once per window', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    const first = checkMcpVersion(mcpRequest('1.52.0'));
    const second = checkMcpVersion(mcpRequest('1.52.0'));
    expect(first?.status).toBe(426);
    expect(second?.status).toBe(426);
    expect((await body(second as Response)).error).toBe((await body(first as Response)).error);
    expect(loggedVersions()).toEqual(['1.52.0']);
  });

  it('still logs the first warning of a different client version', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    checkMcpVersion(mcpRequest('1.52.0'));
    checkMcpVersion(mcpRequest('1.52.0'));
    checkMcpVersion(mcpRequest('1.51.9'));
    expect(loggedVersions()).toEqual(['1.52.0', '1.51.9']);
  });

  it('warns again for the same client version once the required version changes', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    checkMcpVersion(mcpRequest('1.52.0'));
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.561');
    checkMcpVersion(mcpRequest('1.52.0'));
    expect(loggedVersions()).toEqual(['1.52.0', '1.52.0']);
  });

  it('warns once more when the quiet window ends, then goes quiet again', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    checkMcpVersion(mcpRequest('1.52.0'));
    currentTime += MISMATCH_WARNING_WINDOW_MS - 1;
    checkMcpVersion(mcpRequest('1.52.0'));
    expect(warn).toHaveBeenCalledTimes(1);
    currentTime += 1;
    checkMcpVersion(mcpRequest('1.52.0'));
    checkMcpVersion(mcpRequest('1.52.0'));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('quiets the window for one hour', () => {
    expect(MISMATCH_WARNING_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('groups every malformed header under one warning', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    checkMcpVersion(mcpRequest('<script>'));
    checkMcpVersion(mcpRequest('garbage'));
    expect(loggedVersions()).toEqual(['malformed']);
  });

  it('keeps a silenced rejection out of the server_warning telemetry', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    const client = { capture: vi.fn(), captureAs: vi.fn(), captureException: vi.fn(), captureExceptionAs: vi.fn() };
    vi.mocked(getPostHogServer).mockReturnValue(client as unknown as ReturnType<typeof getPostHogServer>);
    const route = withApiErrorReporting('GET /api/account', (request: Request) => {
      return checkMcpVersion(request) ?? new Response(null, { status: 204 });
    });
    checkMcpVersion(mcpRequest('1.52.0'));
    const response = await route(mcpRequest('1.52.0'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(response.status).toBe(426);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.captureAs).not.toHaveBeenCalled();
  });

  it('exports a live gate that rejects a mismatch', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    expect(liveGate(mcpRequest('1.52.0'))?.status).toBe(426);
  });

  it('throws when REQUIRED_MCP_VERSION is missing', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', undefined);
    expect(() => checkMcpVersion(mcpRequest('1.52.560'))).toThrow('REQUIRED_MCP_VERSION is not defined');
  });

  it('throws when REQUIRED_MCP_VERSION is empty', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '');
    expect(() => checkMcpVersion(mcpRequest('1.52.560'))).toThrow('REQUIRED_MCP_VERSION is not defined');
  });

  it('throws when REQUIRED_MCP_VERSION is not MAJOR.MINOR.PATCH', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', 'latest');
    expect(() => checkMcpVersion(mcpRequest('1.52.560'))).toThrow(
      'REQUIRED_MCP_VERSION must be MAJOR.MINOR.PATCH',
    );
  });

  it('reads the same header name the MCP sends', () => {
    const analytics = readFileSync(
      join(findRepoRoot(import.meta.url), 'apps/mcp/src/analytics.ts'),
      'utf8',
    );
    expect(analytics).toContain(`export const MCP_VERSION_HEADER = 'X-MCP-Version';`);
    expect(MCP_VERSION_HEADER).toBe('X-MCP-Version'.toLowerCase());
  });
});
