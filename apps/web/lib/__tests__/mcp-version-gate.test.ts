// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findRepoRoot } from '@/test/repo-root';
import { checkMcpVersion, MCP_VERSION_HEADER } from '../mcp-version-gate';

const warn = vi.hoisted(() => vi.fn(() => 'log-id-1'));
vi.mock('../logger', () => ({
  logger: { warn, error: vi.fn(() => 'log-id-2'), info: vi.fn(), generateLogId: vi.fn() },
}));

function mcpRequest(version?: string): Request {
  const headers: Record<string, string> = { authorization: 'Bearer pe_live_x' };
  if (version !== undefined) headers[MCP_VERSION_HEADER] = version;
  return new Request('http://localhost:3434/api/account', { headers });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('checkMcpVersion', () => {
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

  it('logs every mismatch under one stable message', () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
    checkMcpVersion(mcpRequest('1.52.0'));
    checkMcpVersion(mcpRequest('1.52.561'));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      '[mcp-version-gate] 426 MCP version mismatch',
      '[mcp-version-gate] 426 MCP version mismatch',
    ]);
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
