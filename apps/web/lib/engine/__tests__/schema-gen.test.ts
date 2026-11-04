// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const snapshotPath = join(root, 'apps/engine/openapi.json');
const generatedPath = join(root, 'apps/web/lib/engine/schema.gen.ts');

type Generator = {
  generateEngineTypes: (spec: unknown) => Promise<string>;
};

const loadGenerator = async (): Promise<Generator> =>
  import(join(root, 'apps/web/scripts/generate-engine-types.mjs'));

describe('lib/engine/schema.gen.ts', () => {
  // An engine contract change regenerates apps/engine/openapi.json (the
  // engine's own drift test enforces that); this pins the second hop: the
  // committed web types must be exactly the generator output for it.
  it('matches the generator output for the committed engine snapshot (run node apps/web/scripts/generate-engine-types.mjs)', async () => {
    const { generateEngineTypes } = await loadGenerator();
    const spec: unknown = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    expect(readFileSync(generatedPath, 'utf8')).toBe(await generateEngineTypes(spec));
  });

  it('is marked as generated so nobody edits it by hand', () => {
    expect(readFileSync(generatedPath, 'utf8').startsWith('// GENERATED FILE — do not edit by hand.')).toBe(true);
  });

  it('keeps fields that have an engine default optional in request types', async () => {
    const { generateEngineTypes } = await loadGenerator();
    const text = await generateEngineTypes({
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {},
      components: {
        schemas: {
          Req: {
            type: 'object',
            properties: { volume: { type: 'number', default: 0.2 } },
          },
        },
      },
    });
    expect(text.includes('volume?: number;')).toBe(true);
  });

  it('carries the engine video request contract', () => {
    const generated = readFileSync(generatedPath, 'utf8');
    expect(generated.includes('TaskVideoRequest: {')).toBe(true);
    expect(generated.includes('"/api/v1/videos": {')).toBe(true);
  });
});
