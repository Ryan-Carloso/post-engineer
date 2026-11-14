import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PostEngineerClient } from '../client.js';
import { createPostEngineerMcpServer } from '../index.js';
import { callToolRecordingRequests, requestReaches, type RecordedRequest } from './parity/behaviour.js';
import { buildMcpCallGraph } from './parity/mcp-calls.js';
import { EndpointMappingSchema, endpointToolNames, uncoveredEndpoints, verifyMapping } from './parity/mappings.js';
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
// - parity-endpoint-tools.json: endpoint → [{ tool, action? }]. Capability
//   parity (issue #566): a tool is a complete abstraction of an intent, and
//   no endpoint needs a tool or an action of its own. Each entry is proven by
//   the MCP sources (the tool, or for an action tool the named action's
//   handler, reaches a request site with that method and path) and, for an
//   action, by invoking it (parity-action-samples.json holds the arguments),
//   so adding or extending a tool needs no approval. Coverage stays total:
//   an endpoint no tool reaches and no exclusion covers fails.
// - parity-exclusions.json: { opsPublic, exclusions }. Guarded: adding or
//   changing an entry needs code-owner approval (parity-exclusion-guard).

const here = dirname(fileURLToPath(import.meta.url));
const mcpSrcDir = join(here, '..');
const webDir = join(here, '..', '..', '..', 'web');
const webAppDir = join(webDir, 'app');
const apiDir = join(webAppDir, 'api');
const PARITY: z.infer<typeof ParityDataSchema> = ParityDataSchema.parse(
  JSON.parse(readFileSync(join(here, 'parity-exclusions.json'), 'utf8')),
);
const EXCLUDED_ENDPOINTS = PARITY.exclusions;

const ENDPOINT_MAPPING = EndpointMappingSchema.parse(
  JSON.parse(readFileSync(join(here, 'parity-endpoint-tools.json'), 'utf8')),
);
const ENDPOINT_TOOLS = endpointToolNames(ENDPOINT_MAPPING);

// Calls that invoke one mapped action: `<tool>.<action>` → one or more
// samples, each the tool arguments (including `action`) and, when the action
// must read a listing before it sends its request, the stubbed responses by
// `METHOD /path`. An action that sends different requests on different calls
// (preview, then confirm) lists one sample per call. `{{tmp:NAME}}` in a
// string is the path of a small file the test writes for a local-file action.
// The confirmToken of personas.delete is the digest of the persona id and of
// the stubbed (all-null) preview: it changes when persona-delete.ts changes
// how the token is built, and that failure says so.
const SampleSchema = z.object({ args: z.record(z.string(), z.unknown()), responses: z.record(z.string(), z.unknown()).optional() }).strict();
const ACTION_SAMPLES: Record<string, Array<z.infer<typeof SampleSchema>>> = z
  .record(z.string(), z.array(SampleSchema).min(1))
  .parse(JSON.parse(readFileSync(join(here, 'parity-action-samples.json'), 'utf8')));

const TEMP_DIR = mkdtempSync(join(tmpdir(), 'parity-samples-'));
afterAll(() => rmSync(TEMP_DIR, { recursive: true, force: true }));

function withTempFiles(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{tmp:([\w.-]+)\}\}/g, (_match, name: string) => {
      const file = join(TEMP_DIR, name);
      // A real PNG signature: the media upload checks the content, not the extension.
      writeFileSync(file, name.endsWith('.png') ? Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') : 'sample');
      return file;
    });
  }
  if (Array.isArray(value)) return value.map(withTempFiles);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withTempFiles(inner)]));
  }
  return value;
}

// Tools with no backing web endpoint. Empty today: every tool calls the
// web API through the MCP client. A tool registered anywhere in
// apps/mcp/src must appear here or in parity-endpoint-tools.json — parity
// discovers registrations in every source file, not only index.ts.
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
);
const toolNames = graph.tools;
const mappedTools = new Set(Object.values(ENDPOINT_TOOLS).flat());
const registeredTools = new Set(toolNames);

function libSource(specifier: string): string | undefined {
  if (!specifier.startsWith('@/lib/')) return undefined;
  const file = join(webDir, 'lib', `${specifier.slice('@/lib/'.length)}.ts`);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function importSource(specifier: string, fromFile: string): { file: string; text: string } | undefined {
  const base = specifier.startsWith('@/')
    ? join(webDir, specifier.slice(2))
    : join(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate, text: readFileSync(candidate, 'utf8') };
  }
  return undefined;
}

const context: VerifyContext = {
  route: (key) => endpoints.get(key),
  libSource,
  importSource,
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
    const uncovered = uncoveredEndpoints(discovered, ENDPOINT_MAPPING, EXCLUDED_ENDPOINTS);
    expect(
      uncovered,
      `New web endpoint(s) with no MCP coverage. Make the intent tool that serves it call the endpoint (a new action of an existing tool, not a tool per endpoint) and map { tool, action } in parity-endpoint-tools.json: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('has no mapping or exclusion for an endpoint that no longer exists', () => {
    const known = new Set(discovered);
    const stale = [...Object.keys(ENDPOINT_MAPPING), ...Object.keys(EXCLUDED_ENDPOINTS)].filter(
      (key) => !known.has(key),
    );
    expect(stale, `Stale parity entries for removed endpoints: ${stale.join(', ')}`).toEqual([]);
  });

  it('never maps and excludes the same endpoint', () => {
    const overlap = Object.keys(ENDPOINT_MAPPING).filter((key) => key in EXCLUDED_ENDPOINTS);
    expect(overlap).toEqual([]);
  });

  it('maps only to tools registered in the MCP server', () => {
    const unknown = [...mappedTools].filter((tool) => !registeredTools.has(tool));
    expect(unknown, `Mapped tools not registered in the MCP server: ${unknown.join(', ')}`).toEqual([]);
  });

  it('proves every mapping: each mapped tool (or action) calls its endpoint (same method and path)', () => {
    const unproven = Object.entries(ENDPOINT_MAPPING).flatMap(([key, entries]) => verifyMapping(key, entries, graph));
    expect(unproven, `Mapping(s) the MCP sources do not back:\n${unproven.join('\n')}`).toEqual([]);
  });

  // The syntax tree proves an action's handler can reach its endpoint; this
  // proves that invoking the action sends the request. Vacuous while no tool
  // has actions (the mechanism is pinned in parity/action-mappings.test.ts).
  const mappedActions = Object.entries(ENDPOINT_MAPPING).flatMap(([key, entries]) =>
    entries.flatMap((entry) => (entry.action === undefined ? [] : [{ key, tool: entry.tool, action: entry.action }])),
  );

  it.each(mappedActions)('invoking $tool · $action sends the request for $key', async ({ key, tool, action }) => {
    const samples = ACTION_SAMPLES[`${tool}.${action}`];
    expect(samples, `Add samples for ${tool}.${action} to parity-action-samples.json`).toBeDefined();
    const recorded: RecordedRequest[] = [];
    for (const sample of samples ?? []) {
      expect(sample.args.action, `${tool}.${action} sample must select the action`).toBe(action);
      const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'parity-proof' }), 'stdio');
      const args = withTempFiles(sample.args);
      recorded.push(...(await callToolRecordingRequests(server, tool, typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}, sample.responses)));
    }
    expect(requestReaches(recorded, key), `${tool}.${action} sent ${JSON.stringify(recorded)}, not ${key}`).toBe(true);
  });

  it('keeps an action sample only for a mapped action', () => {
    const mapped = new Set(mappedActions.map(({ tool, action }) => `${tool}.${action}`));
    expect(Object.keys(ACTION_SAMPLES).filter((name) => !mapped.has(name))).toEqual([]);
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
