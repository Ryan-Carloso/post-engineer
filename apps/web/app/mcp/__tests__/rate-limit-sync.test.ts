import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { RATE_LIMITS } from '@/lib/rate-limit';

//---------------
// The hosted /mcp route duplicates literals the standalone MCP listener
// enforces (apps/mcp/src/http-auth.ts + http-rate-limit.ts): the rate
// limits, the required OAuth scope, and the scopes the protected-resource
// document advertises. A drift between the two lets one path be stricter
// than the other for the same caller, so this test pins each shared
// literal to one value, parsed from both sides' sources. (Literal
// regexes only — no dynamic RegExp construction, per the repo's CodeQL
// rule.)
//---------------

function readSource(...parts: string[]): string {
  return readFileSync(join(findRepoRoot(import.meta.url), ...parts), 'utf8');
}

function quotedStrings(list: string): string[] {
  return list
    .split(',')
    .map((item) => item.trim().replace(/^'|'$/g, ''))
    .filter((item) => item !== '');
}

const MCP_AUTH = () => readSource('apps', 'mcp', 'src', 'http-auth.ts');
const MCP_RATE_LIMIT = () => readSource('apps', 'mcp', 'src', 'http-rate-limit.ts');
const WEB_MCP_ROUTE = () => readSource('apps', 'web', 'app', 'mcp', 'route.ts');
const WEB_DISCOVERY_ROUTE = () =>
  readSource('apps', 'web', 'app', '.well-known', 'oauth-protected-resource', 'route.ts');

describe('hosted /mcp literals stay in lockstep with the MCP package', () => {
  it('pins the per-subject limit to the MCP default', () => {
    const match = /DEFAULT_RATE_LIMIT_PER_MINUTE = (\d+)/.exec(MCP_AUTH());
    expect(match?.[1]).toBeDefined();
    expect(RATE_LIMITS.mcpRemote.limit).toBe(Number(match?.[1]));
    expect(RATE_LIMITS.mcpRemote.windowMs).toBe(60_000);
  });

  it('pins the pre-auth per-IP limit to the MCP pre-auth limit', () => {
    const match = /PRE_AUTH_IP_LIMIT_PER_MINUTE = (\d+)/.exec(MCP_RATE_LIMIT());
    expect(match?.[1]).toBeDefined();
    expect(RATE_LIMITS.mcpRemotePreAuth.limit).toBe(Number(match?.[1]));
    expect(RATE_LIMITS.mcpRemotePreAuth.windowMs).toBe(60_000);
  });

  it('pins the required OAuth scope to the one the MCP verifier enforces', () => {
    const mcpScope = /scope\.split\(' '\)\.includes\('([^']+)'\)/.exec(MCP_AUTH());
    const webScope = /MCP_TOOL_SCOPE = '([^']+)'/.exec(WEB_MCP_ROUTE());
    expect(mcpScope?.[1]).toBeDefined();
    expect(webScope?.[1]).toBeDefined();
    expect(webScope?.[1]).toBe(mcpScope?.[1]);
  });

  it('pins the advertised scopes to the MCP protected-resource document', () => {
    const mcpScopes = /scopes_supported: \[([^\]]+)\]/.exec(MCP_AUTH());
    const webScopes = /scopes_supported: \[([^\]]+)\]/.exec(WEB_DISCOVERY_ROUTE());
    expect(mcpScopes?.[1]).toBeDefined();
    expect(webScopes?.[1]).toBeDefined();
    expect(quotedStrings(webScopes?.[1] ?? '')).toEqual(quotedStrings(mcpScopes?.[1] ?? ''));
  });
});
