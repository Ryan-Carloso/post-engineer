import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_SEGMENT_MEDIA_BYTES } from '../limits.js';

// Walk up to the repo root instead of counting parents: Stryker runs the
// suite from a copied tree, which shifts every fixed parent index.
function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    }
    dir = parent;
  }
}

//---------------
// publish_existing reads a local image with the MCP's 8 MB photo limit
// (readLocalImage) and the web route rejects an image over IMAGE_MAX_BYTES.
// The two must be the same number, or the MCP would read a file the server
// then refuses (or refuse one the server takes).
//---------------

describe('publish_existing image size limit', () => {
  it('matches the web route IMAGE_MAX_BYTES', () => {
    const schema = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/app/api/media/publish-existing/schema.ts'), 'utf8');
    const line = schema.split('\n').find((text) => text.startsWith('export const IMAGE_MAX_BYTES = '));
    expect(line).toBe(`export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;`);
    expect(MAX_SEGMENT_MEDIA_BYTES).toBe(8 * 1024 * 1024);
  });
});
