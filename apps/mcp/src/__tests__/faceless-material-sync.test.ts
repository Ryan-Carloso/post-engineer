import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FACELESS_MATERIALS } from '../limits.js';
import { IMAGES_MATERIAL } from '../script-segments.js';

// facelessMaterial is validated by the MCP schemas and by the web routes
// (apps/web/lib/generation/faceless-materials.ts). Nothing is shared
// across the two packages, so a one-sided edit would make the MCP reject
// what the route accepts (or forward what it rejects).
const here = dirname(fileURLToPath(import.meta.url));
const webMaterials = readFileSync(join(here, '..', '..', '..', 'web', 'lib', 'generation', 'faceless-materials.ts'), 'utf8');

describe('facelessMaterial sync with the web', () => {
  it('accepts the same materials as the web routes', () => {
    const list = FACELESS_MATERIALS.map((material) => `'${material}'`).join(', ');
    expect(webMaterials).toContain(`export const FACELESS_MATERIALS = [${list}] as const;`);
  });

  it('names the images material the way the segments validator does', () => {
    expect(FACELESS_MATERIALS).toContain(IMAGES_MATERIAL);
  });
});
