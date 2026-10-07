//---------------
// deploy-build-metadata — the deployment-generated version contract, pinned
// across every file that has to agree on it.
//
// The VPS deploy (deployment repo: deploy-version.sh + deploy.sh) exports
// VERSION / PR_NUMBER / BUILD / COMMIT before `docker compose up --build`.
// The engine reads them at runtime from the environment; the web image bakes
// them in as build args that next.config.ts inlines into the bundle.
//
// A one-sided rename is silent in production: the engine would report
// `pr: null` and the web badge would fall back to the bare version, with no
// error anywhere. This test parses the four build files and asserts the same
// four names appear on each side (SQL-literals sync-test precedent).
//
// @vitest-environment node
//---------------
/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

// The names deploy.sh exports (ENGINE_DEPLOY_* -> export_build_env).
const BUILD_METADATA_VARS = ['VERSION', 'PR_NUMBER', 'BUILD', 'COMMIT'] as const;

function read(...relativePath: string[]): string {
  return readFileSync(join(findRepoRoot(import.meta.url), ...relativePath), 'utf8');
}

describe('deployment build metadata contract', () => {
  it('passes every metadata var to the engine container', () => {
    const compose = read('apps', 'engine', 'docker-compose.yml');
    for (const name of BUILD_METADATA_VARS) {
      expect(compose, `engine compose must forward ${name}`).toContain(
        `${name}: \${${name}:-}`,
      );
    }
  });

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

  it('reads PR_NUMBER on the engine side too', () => {
    // The engine's build info (asgi.py get_build_info) is what /version and
    // /health expose; the web only proxies it.
    const asgi = read('apps', 'engine', 'app', 'asgi.py');
    for (const name of BUILD_METADATA_VARS) {
      expect(asgi, `engine asgi.py must read ${name}`).toContain(`"${name}"`);
    }
  });
});