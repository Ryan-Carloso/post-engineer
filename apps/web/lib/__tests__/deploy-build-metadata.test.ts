// @vitest-environment node
/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const BUILD_METADATA_VARS = ['VERSION', 'PR_NUMBER', 'BUILD', 'COMMIT'] as const;

function read(...relativePath: string[]): string {
  return readFileSync(join(findRepoRoot(import.meta.url), ...relativePath), 'utf8');
}

describe('deployment build metadata contract', () => {
  it('passes every metadata var to the web image as a build arg', () => {
    const compose = read('apps', 'web', 'docker-compose.yml');
    for (const name of BUILD_METADATA_VARS) {
      expect(compose, `web compose build args must forward ${name}`).toContain(
        `${name}: \${${name}:-}`,
      );
    }
  });

  it('declares every metadata var as a web Dockerfile ARG', () => {
    const dockerfile = read('apps', 'web', 'Dockerfile');
    for (const name of BUILD_METADATA_VARS) {
      expect(dockerfile, `web Dockerfile must declare ARG ${name}`).toContain(
        `ARG ${name}=""`,
      );
    }
  });

  it('inlines every metadata var into the web bundle', () => {
    const nextConfig = read('apps', 'web', 'next.config.ts');
    for (const name of BUILD_METADATA_VARS) {
      expect(nextConfig, `next.config.ts must inline ${name}`).toContain(
        `${name}: `,
      );
    }
  });

  it('bakes builtAt after COMMIT/BUILD so the layer is not cached across deploys', () => {
    const webDocker = read('apps', 'web', 'Dockerfile');
    const webCommit = webDocker.indexOf('ARG COMMIT=""');
    const webDate = webDocker.indexOf('date -u +"%Y-%m-%dT%H:%M:%SZ"');
    expect(webCommit).toBeGreaterThan(-1);
    expect(webDate).toBeGreaterThan(webCommit);
  });

  it('inlines BUILT_AT from the build clock in next.config.ts', () => {
    const nextConfig = read('apps', 'web', 'next.config.ts');
    expect(nextConfig).toContain('BUILT_AT: readBuiltAt()');
    const dockerfile = read('apps', 'web', 'Dockerfile');
    expect(dockerfile).toContain('date -u +"%Y-%m-%dT%H:%M:%SZ" > apps/web/.built-at');
    expect(nextConfig).toContain("process.env.BUILT_AT");
  });

  it('records the build timestamp in the image instead of the deploy env', () => {
    const compose = read('apps', 'web', 'docker-compose.yml');
    expect(compose).not.toContain('BUILT_AT:');
  });

  it('requires REQUIRED_MCP_VERSION at runtime in the web container', () => {
    const compose = read('apps', 'web', 'docker-compose.yml');
    const environment = compose.slice(compose.indexOf('    environment:'));
    expect(environment).toContain('REQUIRED_MCP_VERSION: ${REQUIRED_MCP_VERSION:?');
    const gate = read('apps', 'web', 'lib', 'mcp-version-gate.ts');
    expect(gate).toContain('process.env.REQUIRED_MCP_VERSION');
  });
});