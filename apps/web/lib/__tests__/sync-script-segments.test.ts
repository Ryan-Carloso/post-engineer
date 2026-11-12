//---------------
// sync-script-segments — the web image builds from a partial checkout.
//
// apps/web's prebuild runs scripts/sync-script-segments.mjs, which writes the
// generated copies in both apps/web and apps/mcp. The web Dockerfile copies
// only apps/web plus the root scripts/ and shared/ sources, so the script must
// skip apps/mcp instead of failing on its missing parent directory. Without
// either piece the prod web build fails with MODULE_NOT_FOUND/ENOENT.
//---------------
/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
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
const sharedSource = join(repoRoot, 'shared', 'script-segments', 'script-segments.ts');
const syncScript = join(repoRoot, 'scripts', 'sync-script-segments.mjs');
const musicSource = join(repoRoot, 'shared', 'music-mood-field', 'music-mood-field.ts');
const musicScript = join(repoRoot, 'scripts', 'sync-music-mood-field.mjs');
const webTarget = join('apps', 'web', 'lib', 'generation', 'script-segments.ts');
const mcpTarget = join('apps', 'mcp', 'src', 'script-segments.ts');
const musicWebTarget = join('apps', 'web', 'lib', 'generation', 'music-mood-field.ts');
const musicMcpTarget = join('apps', 'mcp', 'src', 'music-mood-field.ts');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createPartialCheckout(options: { withMcp: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-script-segments-'));
  tempDirs.push(root);

  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(syncScript, join(root, 'scripts', 'sync-script-segments.mjs'));
  copyFileSync(musicScript, join(root, 'scripts', 'sync-music-mood-field.mjs'));

  mkdirSync(join(root, 'shared', 'script-segments'), { recursive: true });
  copyFileSync(sharedSource, join(root, 'shared', 'script-segments', 'script-segments.ts'));
  mkdirSync(join(root, 'shared', 'music-mood-field'), { recursive: true });
  copyFileSync(musicSource, join(root, 'shared', 'music-mood-field', 'music-mood-field.ts'));

  mkdirSync(join(root, 'apps', 'web', 'lib', 'generation'), { recursive: true });
  writeFileSync(join(root, webTarget), 'stale web copy\n');

  if (options.withMcp) {
    mkdirSync(join(root, 'apps', 'mcp', 'src'), { recursive: true });
    writeFileSync(join(root, mcpTarget), 'stale mcp copy\n');
  }

  return root;
}

function runSync(root: string): string {
  return execFileSync(process.execPath, [join(root, 'scripts', 'sync-script-segments.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('sync-script-segments in a partial checkout', () => {
  it('skips the app directories that are not present instead of failing', () => {
    const root = createPartialCheckout({ withMcp: false });

    const output = runSync(root);

    expect(readFileSync(join(root, webTarget), 'utf8')).toBe(
      readFileSync(sharedSource, 'utf8'),
    );
    expect(readFileSync(join(root, musicWebTarget), 'utf8')).toBe(
      readFileSync(musicSource, 'utf8'),
    );
    expect(output).toContain(`skipped ${join(root, mcpTarget)}`);
    expect(output).toContain(`skipped ${join(root, musicMcpTarget)}`);
  });

  it('syncs every app directory that is present', () => {
    const root = createPartialCheckout({ withMcp: true });

    runSync(root);

    const source = readFileSync(sharedSource, 'utf8');
    expect(readFileSync(join(root, webTarget), 'utf8')).toBe(source);
    expect(readFileSync(join(root, mcpTarget), 'utf8')).toBe(source);
    const music = readFileSync(musicSource, 'utf8');
    expect(readFileSync(join(root, musicWebTarget), 'utf8')).toBe(music);
    expect(readFileSync(join(root, musicMcpTarget), 'utf8')).toBe(music);
  });

  it('forwards --check to the music-mood sync and does not rewrite a drifted copy', () => {
    const root = createPartialCheckout({ withMcp: false });
    runSync(root);
    writeFileSync(join(root, musicWebTarget), 'stale music\n');

    let failed = false;
    let output = '';
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'sync-script-segments.mjs'), '--check'], {
        cwd: root,
        encoding: 'utf8',
      });
    } catch (error) {
      failed = true;
      output = (error as { stdout?: string }).stdout ?? '';
    }

    expect(failed).toBe(true);
    expect(output).toContain(`drifted ${join(root, musicWebTarget)}`);
    expect(readFileSync(join(root, musicWebTarget), 'utf8')).toBe('stale music\n');
  });
});

describe('web Dockerfile prebuild inputs', () => {
  it('copies scripts/ and shared/ because apps/web prebuild reads them', () => {
    const dockerfile = readFileSync(join(repoRoot, 'apps', 'web', 'Dockerfile'), 'utf8');
    const webPackage = JSON.parse(
      readFileSync(join(repoRoot, 'apps', 'web', 'package.json'), 'utf8'),
    ) as { scripts: { prebuild: string } };

    expect(webPackage.scripts.prebuild).toContain('../../scripts/sync-script-segments.mjs');
    expect(dockerfile).toContain('COPY scripts ./scripts');
    expect(dockerfile).toContain('COPY shared ./shared');
  });
});
