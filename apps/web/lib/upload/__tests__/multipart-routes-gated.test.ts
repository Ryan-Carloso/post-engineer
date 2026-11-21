// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '@/test/repo-root';

const WEB_ROOT = join(findRepoRoot(import.meta.url), 'apps', 'web');

const GATED_ROUTES = [
  'app/api/upload-content/route.ts',
  'app/api/media/upload/route.ts',
  'app/api/persona/cloned-voices/route.ts',
  'app/api/persona/cloned-voices/denoise-preview/route.ts',
  'app/api/persona/images/route.ts',
];

const UNGATED_FORM_DATA_READERS = [
  'app/api/bluesky-connect/route.ts',
  'app/api/persona/patch-body.ts',
  'app/api/persona/route.ts',
  'app/api/rumble-connect/route.ts',
  'app/api/telegram-connect/route.ts',
  'app/api/threespeak-connect/route.ts',
  'app/oauth/approve/route.ts',
  'app/oauth/token/route.ts',
];

const DIRECT_FORM_DATA = '.formData()';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__') found.push(...sourceFiles(path));
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      found.push(path);
    }
  }
  return found;
}

describe('multipart upload routes', () => {
  it.each(GATED_ROUTES)('%s parses its body only through readBoundedFormData', (route) => {
    const source = readFileSync(join(WEB_ROOT, route), 'utf8');
    expect(source).toContain('readBoundedFormData(');
    expect(source.includes(DIRECT_FORM_DATA)).toBe(false);
  });

  it('keeps every other direct formData() read in the known list', () => {
    const readers = [...sourceFiles(join(WEB_ROOT, 'app/api')), ...sourceFiles(join(WEB_ROOT, 'app/oauth'))]
      .filter((file) => readFileSync(file, 'utf8').includes(DIRECT_FORM_DATA))
      .map((file) => relative(WEB_ROOT, file))
      .sort();
    expect(readers).toEqual([...UNGATED_FORM_DATA_READERS].sort());
  });
});
