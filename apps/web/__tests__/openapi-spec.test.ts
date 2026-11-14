// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const mappingPath = join(root, 'apps/mcp/src/__tests__/parity-endpoint-tools.json');
const specPath = join(root, 'apps/web/public/openapi.json');

type Spec = { paths: Record<string, Record<string, { operationId: string }>> };

const mapping: Record<string, Array<{ tool: string; action?: string }>> = JSON.parse(readFileSync(mappingPath, 'utf8'));
const spec: Spec = JSON.parse(readFileSync(specPath, 'utf8'));

const specKeys = (): string[] =>
  Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
  );

const toTemplated = (route: string): string => route.replace(/\[(?:\.\.\.)?(\w+)\]/g, '{$1}');

describe('public/openapi.json', () => {
  // A schema, mapping or version change that is not regenerated would ship
  // a stale spec; the committed file must be exactly the generator output.
  it('matches the generator output (run node apps/web/scripts/generate-openapi.mjs)', async () => {
    const generator: {
      buildSpec: (m: Record<string, Array<{ tool: string; action?: string }>>, version: string) => unknown;
      API_SPEC_VERSION: string;
    } = await import(join(root, 'apps/web/scripts/generate-openapi.mjs'));
    expect(spec).toEqual(generator.buildSpec(mapping, generator.API_SPEC_VERSION));
  });

  // The MCP release stamps its generated version into apps/mcp/package.json
  // only inside the publish job; tying the spec version to it would ship a
  // stale openapi.json.
  it('does not take its version from the MCP package', () => {
    const generatorSource = readFileSync(join(root, 'apps/web/scripts/generate-openapi.mjs'), 'utf8');
    expect(generatorSource.includes('apps/mcp/package.json')).toBe(false);
  });

  it('documents exactly the endpoints in the MCP parity mapping', () => {
    const expected = Object.keys(mapping).map((key) => {
      const [method, route] = key.split(' ');
      return `${method} ${toTemplated(route)}`;
    });
    expect(specKeys().sort()).toEqual(expected.sort());
  });

  it('points every documented endpoint at a real route file', () => {
    expect(Object.keys(mapping).length).toBeGreaterThan(0);
    for (const key of Object.keys(mapping)) {
      const route = key.split(' ')[1];
      const file = join(root, 'apps/web/app', route, 'route.ts');
      expect(existsSync(file), `${route} has no route.ts`).toBe(true);
    }
  });

  it('lists the same endpoints in api-documentation.txt as in the spec', () => {
    const doc = readFileSync(join(root, 'apps/web/public/api-documentation.txt'), 'utf8');
    const section = doc.split('ENDPOINTS (all require an API key)')[1].split('Not in this list')[0];
    const documented = [...section.matchAll(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/\S+)/gm)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(documented.length).toBeGreaterThan(0);
    expect(documented.sort()).toEqual(specKeys().sort());
  });

  it('resolves every $ref and attaches schemas only to mapped endpoints', async () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    const components = (spec as unknown as { components: { schemas: Record<string, unknown> } })
      .components.schemas;
    for (const name of refs) expect(components[name], `missing schema ${name}`).toBeDefined();

    const schemasModule: { operationSchemas: Record<string, unknown> } = await import(
      join(root, 'apps/web/scripts/openapi-schemas.mjs')
    );
    for (const key of Object.keys(schemasModule.operationSchemas)) {
      expect(Object.keys(mapping), `${key} is not a mapped endpoint`).toContain(key);
    }
  });

  it('documents a JSON or binary success response for every operation', () => {
    const ops = Object.values(spec.paths).flatMap((methods) => Object.values(methods));
    for (const op of ops as unknown as Array<{ operationId: string; responses: Record<string, { content?: unknown }> }>) {
      expect(op.responses['200'].content, `${op.operationId} has no typed 200`).toBeDefined();
    }
  });

  // Statuses a client must branch on, beyond the shared 400/401/404/429.
  it('documents the route-specific statuses clients must handle', () => {
    const ops = spec.paths as unknown as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    const statuses = (path: string, method: string): string[] => Object.keys(ops[path][method].responses);
    expect(statuses('/api/videos/generate-and-schedule', 'post')).toEqual(expect.arrayContaining(['402', '409', '502']));
    expect(statuses('/api/persona/video-status/{taskId}', 'get')).toEqual(expect.arrayContaining(['410', '502']));
  });

  it('documents the score-draft result fields, not just success', () => {
    const ops = spec.paths as unknown as Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: { properties: Record<string, unknown> } }> }> }>>;
    const props = ops['/api/videos/score-draft'].post.responses['200'].content['application/json'].schema.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['score', 'reasons', 'counts', 'baseline', 'publishCheck']));
  });

  it('uses unique operation ids and Bearer security on every operation', () => {
    const ids = Object.values(spec.paths).flatMap((ops) =>
      Object.values(ops).map((op) => op.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(spec)).toContain('"bearerAuth"');
  });

  // Issue #566: an endpoint is mapped to { tool, action? }, so an action of an
  // intent tool names its operation `<tool>_<action>`.
  it('names an operation after its first mapping entry: <tool>_<action> for an action, <tool> otherwise', async () => {
    const generator: {
      buildSpec: (m: Record<string, Array<{ tool: string; action?: string }>>, version: string) => {
        paths: Record<string, Record<string, { operationId: string; summary: string }>>;
      };
    } = await import(join(root, 'apps/web/scripts/generate-openapi.mjs'));
    const built = generator.buildSpec(
      { 'GET /api/persona/list': [{ tool: 'personas', action: 'list' }], 'GET /api/billing/tokens': [{ tool: 'get_token_balance' }] },
      '0.0.0',
    );
    expect(built.paths['/api/persona/list'].get).toMatchObject({ operationId: 'get_personas_list', summary: 'personas list' });
    expect(built.paths['/api/billing/tokens'].get).toMatchObject({ operationId: 'get_get_token_balance', summary: 'get token balance' });
  });
});
