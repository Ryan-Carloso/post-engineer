import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Deploy surface for the remote MCP (issue #561, workstream E). These are
// file-parsing pins: the compose/Dockerfile/docs are the deliverable (no
// deploy runs in CI), so the test asserts the safety properties the
// runtime also enforces — loopback-only publish, OAuth env required,
// and a health check on the unauthenticated /health probe.
const here = dirname(fileURLToPath(import.meta.url));
const mcpDir = join(here, '..', '..');
const repoRoot = join(mcpDir, '..', '..');

function read(rel: string): string {
  return readFileSync(join(mcpDir, rel), 'utf8');
}

describe('MCP HTTP deploy surface', () => {
  const compose = read('docker-compose.yml');

  it('publishes only a loopback host port behind the proxy', () => {
    expect(compose).toContain('127.0.0.1:8081:8081');
    expect(compose).not.toMatch(/^\s*-\s*"8081:8081"/m);
    expect(compose).not.toContain('0.0.0.0:8081');
  });

  it('requires the OAuth env at startup', () => {
    expect(compose).toContain('MCP_OAUTH_ISSUER:?');
    expect(compose).toContain('MCP_RESOURCE:?');
  });

  it('health-checks the /health probe and restarts unless stopped', () => {
    expect(compose).toContain('http://127.0.0.1:8081/health');
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('container_name: post-engineer-mcp');
  });

  it('builds the HTTP image from the monorepo root and runs the HTTP transport', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('--http-transport');
    expect(dockerfile).toContain('--allow-remote');
    expect(dockerfile).toContain('pnpm --filter post-engineer-mcp --legacy deploy --prod /out');
    expect(dockerfile).toContain('COPY --from=builder /out ./');
    expect(dockerfile).not.toContain('COPY --from=builder /repo/apps/mcp/node_modules');
    expect(compose).toContain('dockerfile: apps/mcp/Dockerfile');
    expect(compose).toContain('context: ../..');
  });

  it('documents the public route in the MCP README and self-hosting guide', () => {
    expect(read('README.md')).toContain('https://post-engineer.com/mcp');
    const selfHosting = readFileSync(join(repoRoot, 'docs', 'SELF_HOSTING.md'), 'utf8');
    expect(selfHosting).toContain('post-engineer.com/mcp');
    expect(selfHosting).toContain('127.0.0.1:8081');
    expect(selfHosting).toContain('/mcp');
  });

  it('advertises the remote in server.json alongside the stdio package', () => {
    const serverJson = JSON.parse(read('server.json')) as {
      remotes?: Array<{ type: string; url: string }>;
    };
    expect(serverJson.remotes).toContainEqual({
      type: 'streamable-http',
      url: 'https://post-engineer.com/mcp',
    });
  });
});
