import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readPackageVersion } from '../package-version.js';

const dirs: string[] = [];

function layout(files: Record<string, string>, entry: string): string {
  const root = mkdtempSync(join(tmpdir(), 'package-version-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  mkdirSync(join(root, entry, '..'), { recursive: true });
  return pathToFileURL(join(root, entry)).href;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readPackageVersion', () => {
  it('reads the running package version by default', () => {
    const pkg: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg).toMatchObject({ version: readPackageVersion() });
  });

  it('finds package.json from the built dist layout', () => {
    const url = layout(
      { 'package.json': '{"name":"post-engineer-mcp","version":"9.8.7"}' },
      'dist/apps/mcp/src/index.js',
    );
    expect(readPackageVersion(url)).toBe('9.8.7');
  });

  it('skips a package.json that names another package', () => {
    const url = layout(
      {
        'package.json': '{"name":"post-engineer-mcp","version":"1.2.3"}',
        'dist/package.json': '{"name":"other","version":"0.0.1"}',
      },
      'dist/index.js',
    );
    expect(readPackageVersion(url)).toBe('1.2.3');
  });

  it('throws when no package.json names this package', () => {
    const url = layout({ 'a/package.json': '{"name":"other","version":"0.0.1"}' }, 'a/index.js');
    expect(() => readPackageVersion(url)).toThrow('package.json not found');
  });
});
