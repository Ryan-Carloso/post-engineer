//---------------
// sync-contracts — stale generated copies and the Docker install layer.
//
// scripts/sync-contracts.mjs deletes generated copies whose shared source
// no longer exists: after a contract rename the old copy must be gone, not
// left behind as an empty non-module (tsc then points at the import site
// instead of a missing file). The root postinstall runs the sync, so both
// Dockerfiles must copy the script and its shared source BEFORE
// `pnpm install` — otherwise the install layer fails with MODULE_NOT_FOUND
// and the production deploy breaks.
//---------------
/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);
const syncScript = join(repoRoot, 'scripts', 'sync-contracts.mjs');
const endpointSource = join(repoRoot, 'shared', 'contracts', 'endpoint.ts');
const experimentsSource = join(repoRoot, 'shared', 'contracts', 'experiments.ts');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createPartialCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-contracts-'));
  tempDirs.push(root);

  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(syncScript, join(root, 'scripts', 'sync-contracts.mjs'));

  mkdirSync(join(root, 'shared', 'contracts'), { recursive: true });
  copyFileSync(endpointSource, join(root, 'shared', 'contracts', 'endpoint.ts'));
  copyFileSync(experimentsSource, join(root, 'shared', 'contracts', 'experiments.ts'));

  mkdirSync(join(root, 'apps', 'web', 'lib', 'contracts'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'lib', 'contracts', 'stale.ts'), 'stale web copy\n');
  mkdirSync(join(root, 'apps', 'mcp', 'src', 'contracts'), { recursive: true });
  writeFileSync(join(root, 'apps', 'mcp', 'src', 'contracts', 'stale.ts'), 'stale mcp copy\n');

  return root;
}

function runSync(root: string, args: string[] = []): string {
  return execFileSync(process.execPath, [join(root, 'scripts', 'sync-contracts.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('sync-contracts stale generated files', () => {
  it('deletes a stale generated file instead of emptying it', () => {
    const root = createPartialCheckout();

    const output = runSync(root);

    const webStale = join(root, 'apps', 'web', 'lib', 'contracts', 'stale.ts');
    const mcpStale = join(root, 'apps', 'mcp', 'src', 'contracts', 'stale.ts');
    expect(existsSync(webStale)).toBe(false);
    expect(existsSync(mcpStale)).toBe(false);
    expect(output).toContain(`removed ${webStale}`);
    expect(output).toContain(`removed ${mcpStale}`);
    // The live contracts are still generated.
    expect(readFileSync(join(root, 'apps', 'web', 'lib', 'contracts', 'experiments.ts'), 'utf8')).toContain(
      'GENERATED from shared/contracts',
    );
    expect(readFileSync(join(root, 'apps', 'mcp', 'src', 'contracts', 'experiments.ts'), 'utf8')).toContain(
      'GENERATED from shared/contracts',
    );
  });

  it('reports a stale file as drifted under --check and leaves it in place', () => {
    const root = createPartialCheckout();

    let failed = false;
    let output = '';
    try {
      runSync(root, ['--check']);
    } catch (error) {
      failed = true;
      output = (error as { stdout?: string }).stdout ?? '';
    }

    expect(failed).toBe(true);
    const webStale = join(root, 'apps', 'web', 'lib', 'contracts', 'stale.ts');
    expect(output).toContain(`drifted ${webStale} (no shared source)`);
    expect(readFileSync(webStale, 'utf8')).toBe('stale web copy\n');
  });
});

describe('Docker install layers run the contracts sync', () => {
  it('copies the sync script and its shared source before pnpm install in both images', () => {
    for (const dockerfilePath of [join(repoRoot, 'apps', 'web', 'Dockerfile'), join(repoRoot, 'apps', 'mcp', 'Dockerfile')]) {
      const dockerfile = readFileSync(dockerfilePath, 'utf8');
      const installAt = dockerfile.indexOf('RUN pnpm install');
      expect(installAt).toBeGreaterThan(0);
      expect(dockerfile.indexOf('COPY scripts/sync-contracts.mjs scripts/')).toBeGreaterThan(-1);
      expect(dockerfile.indexOf('COPY scripts/sync-contracts.mjs scripts/')).toBeLessThan(installAt);
      expect(dockerfile.indexOf('COPY shared/contracts shared/contracts')).toBeGreaterThan(-1);
      expect(dockerfile.indexOf('COPY shared/contracts shared/contracts')).toBeLessThan(installAt);
    }
  });
});
