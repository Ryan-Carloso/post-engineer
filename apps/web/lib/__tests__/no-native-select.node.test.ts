import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '../../test/repo-root';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.stryker-tmp', 'coverage']);
const NATIVE_SELECT_OPENING = new RegExp(`${'<'}select(?=[\\s>/])`);

function containsNativeSelect(source: string): boolean {
  return NATIVE_SELECT_OPENING.test(source);
}

function tsxFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : tsxFilesUnder(join(directory, entry.name));
    }
    return entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : [];
  });
}

describe('native select gate', () => {
  it('flags an opening select tag followed by attributes, a newline or a closing bracket', () => {
    expect(containsNativeSelect('<select value={a}>')).toBe(true);
    expect(containsNativeSelect('<select\n  id="x"')).toBe(true);
    expect(containsNativeSelect('<select>')).toBe(true);
  });

  it('ignores other tags and words that merely start with select', () => {
    expect(containsNativeSelect('<SelectField id="x" />')).toBe(false);
    expect(containsNativeSelect('<selection />')).toBe(false);
    expect(containsNativeSelect("document.querySelector('select')")).toBe(false);
  });

  it('finds the app tsx files to scan', () => {
    const root = join(findRepoRoot(import.meta.url), 'apps/web');
    const files = tsxFilesUnder(root).map((file) => relative(root, file));
    expect(files).toContain(join('components', 'ui', 'select.tsx'));
    expect(files.some((file) => file.split('/').includes('node_modules'))).toBe(false);
  });

  it('keeps every dropdown on components/ui/select.tsx instead of a native select element', () => {
    const root = join(findRepoRoot(import.meta.url), 'apps/web');
    const offenders = tsxFilesUnder(root)
      .filter((file) => containsNativeSelect(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
