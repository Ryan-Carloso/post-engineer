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
const sharedMedia = join(repoRoot, 'shared', 'script-segments', 'segment-media.ts');
const sharedText = join(repoRoot, 'shared', 'script-segments', 'segment-text.ts');
const sharedHookTitle = join(repoRoot, 'shared', 'script-segments', 'hook-title.ts');
const syncScript = join(repoRoot, 'scripts', 'sync-script-segments.mjs');
const musicSource = join(repoRoot, 'shared', 'music-mood-field', 'music-mood-field.ts');
const musicScript = join(repoRoot, 'scripts', 'sync-music-mood-field.mjs');
const webTarget = join('apps', 'web', 'lib', 'generation', 'script-segments.ts');
const mcpTarget = join('apps', 'mcp', 'src', 'script-segments.ts');
const webMediaTarget = join('apps', 'web', 'lib', 'generation', 'segment-media.ts');
const mcpMediaTarget = join('apps', 'mcp', 'src', 'segment-media.ts');
const webTextTarget = join('apps', 'web', 'lib', 'generation', 'segment-text.ts');
const mcpTextTarget = join('apps', 'mcp', 'src', 'segment-text.ts');
const webHookTitleTarget = join('apps', 'web', 'lib', 'generation', 'hook-title.ts');
const mcpHookTitleTarget = join('apps', 'mcp', 'src', 'hook-title.ts');
const musicWebTarget = join('apps', 'web', 'lib', 'generation', 'music-mood-field.ts');
const musicMcpTarget = join('apps', 'mcp', 'src', 'music-mood-field.ts');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createPartialCheckout(options: { withMcp: boolean; base?: string }): string {
  const root = mkdtempSync(join(options.base ?? tmpdir(), 'sync-script-segments-'));
  tempDirs.push(root);

  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(syncScript, join(root, 'scripts', 'sync-script-segments.mjs'));
  copyFileSync(musicScript, join(root, 'scripts', 'sync-music-mood-field.mjs'));

  mkdirSync(join(root, 'shared', 'script-segments'), { recursive: true });
  copyFileSync(sharedSource, join(root, 'shared', 'script-segments', 'script-segments.ts'));
  copyFileSync(sharedMedia, join(root, 'shared', 'script-segments', 'segment-media.ts'));
  copyFileSync(sharedText, join(root, 'shared', 'script-segments', 'segment-text.ts'));
  copyFileSync(sharedHookTitle, join(root, 'shared', 'script-segments', 'hook-title.ts'));
  mkdirSync(join(root, 'shared', 'music-mood-field'), { recursive: true });
  copyFileSync(musicSource, join(root, 'shared', 'music-mood-field', 'music-mood-field.ts'));

  mkdirSync(join(root, 'apps', 'web', 'lib', 'generation'), { recursive: true });
  writeFileSync(join(root, webTarget), 'stale web copy\n');
  writeFileSync(join(root, webMediaTarget), 'stale web media copy\n');
  writeFileSync(join(root, webTextTarget), 'stale web text copy\n');
  writeFileSync(join(root, webHookTitleTarget), 'stale web hook title copy\n');

  if (options.withMcp) {
    mkdirSync(join(root, 'apps', 'mcp', 'src'), { recursive: true });
    writeFileSync(join(root, mcpTarget), 'stale mcp copy\n');
    writeFileSync(join(root, mcpMediaTarget), 'stale mcp media copy\n');
    writeFileSync(join(root, mcpTextTarget), 'stale mcp text copy\n');
    writeFileSync(join(root, mcpHookTitleTarget), 'stale mcp hook title copy\n');
  }

  return root;
}

function runSync(root: string): string {
  return execFileSync(process.execPath, [join(root, 'scripts', 'sync-script-segments.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

function toWebCopy(sourceText: string): string {
  return sourceText.replace(/from '(\.\/[^']+)\.js'/g, "from '$1'");
}

describe('sync-script-segments in a partial checkout', () => {
  it('skips the app directories that are not present instead of failing', () => {
    const root = createPartialCheckout({ withMcp: false });

    const output = runSync(root);

    expect(readFileSync(join(root, webTarget), 'utf8')).toBe(
      toWebCopy(readFileSync(sharedSource, 'utf8')),
    );
    expect(readFileSync(join(root, webMediaTarget), 'utf8')).toBe(
      readFileSync(sharedMedia, 'utf8'),
    );
    expect(readFileSync(join(root, webTextTarget), 'utf8')).toBe(
      readFileSync(sharedText, 'utf8'),
    );
    expect(readFileSync(join(root, musicWebTarget), 'utf8')).toBe(
      readFileSync(musicSource, 'utf8'),
    );
    expect(output).toContain(`skipped ${join(root, mcpTarget)}`);
    expect(output).toContain(`skipped ${join(root, mcpMediaTarget)}`);
    expect(output).toContain(`skipped ${join(root, mcpTextTarget)}`);
    expect(output).toContain(`skipped ${join(root, mcpHookTitleTarget)}`);
    expect(output).toContain(`skipped ${join(root, musicMcpTarget)}`);
  });

  it('syncs every app directory that is present', () => {
    const root = createPartialCheckout({ withMcp: true });

    runSync(root);

    const source = readFileSync(sharedSource, 'utf8');
    expect(readFileSync(join(root, webTarget), 'utf8')).toBe(toWebCopy(source));
    expect(readFileSync(join(root, mcpTarget), 'utf8')).toBe(source);
    const media = readFileSync(sharedMedia, 'utf8');
    expect(readFileSync(join(root, webMediaTarget), 'utf8')).toBe(media);
    expect(readFileSync(join(root, mcpMediaTarget), 'utf8')).toBe(media);
    const text = readFileSync(sharedText, 'utf8');
    expect(readFileSync(join(root, webTextTarget), 'utf8')).toBe(text);
    expect(readFileSync(join(root, mcpTextTarget), 'utf8')).toBe(text);
    const hookTitle = readFileSync(sharedHookTitle, 'utf8');
    expect(readFileSync(join(root, webHookTitleTarget), 'utf8')).toBe(hookTitle);
    expect(readFileSync(join(root, mcpHookTitleTarget), 'utf8')).toBe(hookTitle);
    const music = readFileSync(musicSource, 'utf8');
    expect(readFileSync(join(root, musicWebTarget), 'utf8')).toBe(music);
    expect(readFileSync(join(root, musicMcpTarget), 'utf8')).toBe(music);
  });

  it('keeps the MCP copy byte-identical when the checkout path contains apps/web', () => {
    const base = join(tmpdir(), 'apps', 'web-tools');
    mkdirSync(base, { recursive: true });
    const root = createPartialCheckout({ withMcp: true, base });

    runSync(root);

    const source = readFileSync(sharedSource, 'utf8');
    expect(root).toContain(join('apps', 'web'));
    expect(readFileSync(join(root, webTarget), 'utf8')).toBe(toWebCopy(source));
    expect(readFileSync(join(root, mcpTarget), 'utf8')).toBe(source);
    expect(readFileSync(join(root, mcpTarget), 'utf8')).toContain('./segment-media.js');
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
