import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildMcpCallGraph, toolCallsEndpoint } from './parity/mcp-calls.js';
import { ParityDataSchema, verifyExclusion, type VerifyContext } from './parity/exclusions.js';
import { readRouteFile, type HandlerFacts, type RouteFile } from './parity/route-facts.js';

// Web -> MCP parity: every web API endpoint (apps/web/app/api/**/route.ts)
// must either map to an MCP tool that really calls it or carry an exclusion
// whose typed kind is verified mechanically against the route (see
// parity/exclusions.ts for the kinds and their checks). A new endpoint with
// no entry fails, and so does a mapping or exclusion that is not true of
// the code (issues #209/#245/#256: free-text reasons like "dashboard-only"
// let agents skip the tool).
//
// Sources are read as TypeScript syntax trees (parity/ts-source.ts), so a
// comment or a string never satisfies a check, and auth is checked per
// exported handler.
//
// Data files:
// - parity-endpoint-tools.json: endpoint → MCP tools. Each pair is proven
//   by the MCP sources (the tool reaches a request site with that method
//   and path), so adding a tool needs no approval.
// - parity-exclusions.json: { opsPublic, exclusions }. Guarded: adding or
//   changing an entry needs code-owner approval (parity-exclusion-guard).

const here = dirname(fileURLToPath(import.meta.url));
const mcpSrcDir = join(here, '..');
const webDir = join(here, '..', '..', '..', 'web');
const webAppDir = join(webDir, 'app');
const apiDir = join(webAppDir, 'api');
const indexFile = join(mcpSrcDir, 'index.ts');

const PARITY: z.infer<typeof ParityDataSchema> = ParityDataSchema.parse(
  JSON.parse(readFileSync(join(here, 'parity-exclusions.json'), 'utf8')),
);
const EXCLUDED_ENDPOINTS = PARITY.exclusions;

const ENDPOINT_TOOLS: Record<string, string[]> = z
  .record(z.string(), z.array(z.string().min(1)))
  .parse(JSON.parse(readFileSync(join(here, 'parity-endpoint-tools.json'), 'utf8')));

// Tools with no backing web endpoint. Empty today: every tool calls the
// web API through the MCP client. Kept so a future local-only tool has a
// declared home instead of breaking the reverse check.
const WEBLESS_TOOLS: Record<string, string> = {};

function collectFiles(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...collectFiles(full, accept));
    } else if (entry.isFile() && accept(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

interface DiscoveredHandler {
  route: RouteFile;
  handler: HandlerFacts;
}

function discoverEndpoints(): Map<string, DiscoveredHandler> {
  const endpoints = new Map<string, DiscoveredHandler>();
  for (const file of collectFiles(apiDir, (name) => name === 'route.ts')) {
    const route = readRouteFile(file, readFileSync(file, 'utf8'));
    if (route.handlers.length === 0) {
      throw new Error(
        `${file}: no exported handler with a withApiErrorReporting label found; every API handler must be labelled so parity discovery sees it`,
      );
    }
    const expectedPath = `/${relative(webAppDir, dirname(file)).split(sep).join('/')}`;
    for (const handler of route.handlers) {
      const [labelMethod, ...rest] = handler.label.split(' ');
      if (labelMethod !== handler.method) {
        throw new Error(
          `${file}: withApiErrorReporting label method ${labelMethod} does not match exported handler ${handler.method}`,
        );
      }
      if (rest.join(' ') !== expectedPath) {
        throw new Error(
          `${file}: withApiErrorReporting label path ${rest.join(' ')} does not match file-derived path ${expectedPath}`,
        );
      }
      endpoints.set(handler.label, { route, handler });
    }
  }
  return endpoints;
}

const endpoints = discoverEndpoints();
const discovered = [...endpoints.keys()].sort();
const graph = buildMcpCallGraph(
  collectFiles(mcpSrcDir, (name) => name.endsWith('.ts')).map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  })),
  indexFile,
);
const toolNames = graph.tools;
const mappedTools = new Set(Object.values(ENDPOINT_TOOLS).flat());
const registeredTools = new Set(toolNames);

function libSource(specifier: string): string | undefined {
  if (!specifier.startsWith('@/lib/')) return undefined;
  const file = join(webDir, 'lib', `${specifier.slice('@/lib/'.length)}.ts`);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

const context: VerifyContext = {
  route: (key) => endpoints.get(key),
  libSource,
  endpointTools: ENDPOINT_TOOLS,
  graph,
  opsPublic: PARITY.opsPublic,
};

describe('Web -> MCP parity', () => {
  it('discovers web endpoints and registered MCP tools', () => {
    expect(discovered.length).toBeGreaterThan(0);
    expect(toolNames.length).toBeGreaterThan(0);
  });

  it('maps every discovered endpoint to an MCP tool or a typed exclusion', () => {
    const uncovered = discovered.filter(
      (key) => !(key in ENDPOINT_TOOLS) && !(key in EXCLUDED_ENDPOINTS),
    );
    expect(
      uncovered,
      `New web endpoint(s) with no MCP coverage. Add an MCP tool that calls the endpoint and map it in parity-endpoint-tools.json: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('has no mapping or exclusion for an endpoint that no longer exists', () => {
    const known = new Set(discovered);
    const stale = [...Object.keys(ENDPOINT_TOOLS), ...Object.keys(EXCLUDED_ENDPOINTS)].filter(
      (key) => !known.has(key),
    );
    expect(stale, `Stale parity entries for removed endpoints: ${stale.join(', ')}`).toEqual([]);
  });

  it('never maps and excludes the same endpoint', () => {
    const overlap = Object.keys(ENDPOINT_TOOLS).filter((key) => key in EXCLUDED_ENDPOINTS);
    expect(overlap).toEqual([]);
  });

  it('maps every endpoint to at least one tool', () => {
    for (const [key, tools] of Object.entries(ENDPOINT_TOOLS)) {
      expect(tools.length, `${key} maps to no tool`).toBeGreaterThan(0);
    }
  });

  it('maps only to tools registered in the MCP server', () => {
    const unknown = [...mappedTools].filter((tool) => !registeredTools.has(tool));
    expect(unknown, `Mapped tools not registered in index.ts: ${unknown.join(', ')}`).toEqual([]);
  });

  it('proves every mapping: each mapped tool calls its endpoint (same method and path)', () => {
    const unproven: string[] = [];
    for (const [key, tools] of Object.entries(ENDPOINT_TOOLS)) {
      for (const tool of tools) {
        if (!toolCallsEndpoint(graph, tool, key)) unproven.push(`${key} -> ${tool}`);
      }
    }
    expect(
      unproven,
      `Mapped tool(s) that never call their endpoint in the MCP sources: ${unproven.join(', ')}`,
    ).toEqual([]);
  });

  it('covers every registered MCP tool with at least one endpoint or a webless declaration', () => {
    const uncovered = toolNames.filter(
      (tool) => !mappedTools.has(tool) && !(tool in WEBLESS_TOOLS),
    );
    expect(
      uncovered,
      `Registered MCP tool(s) with no backing web endpoint. Map them in parity-endpoint-tools.json or declare them in WEBLESS_TOOLS: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('declares webless tools that are actually registered', () => {
    const unknown = Object.keys(WEBLESS_TOOLS).filter((tool) => !registeredTools.has(tool));
    expect(unknown).toEqual([]);
  });

  // The exclusion file is parsed by ParityDataSchema above, so an unknown
  // kind, a free-text reason, or an extra field already fails before this
  // point. These per-entry checks prove the claim against the route.
  it.each(Object.entries(EXCLUDED_ENDPOINTS))(
    'verifies the %s exclusion against its route',
    (key, exclusion) => {
      expect(verifyExclusion(key, exclusion, context)).toEqual([]);
    },
  );

  it('keeps the ops-public list closed and in sync with the exclusions', () => {
    const declared = Object.entries(EXCLUDED_ENDPOINTS)
      .filter(([, exclusion]) => exclusion.kind === 'ops-public')
      .map(([key]) => key)
      .sort();
    expect(declared).toEqual([...PARITY.opsPublic].sort());
  });
});
