import ts from 'typescript';
import { calleeName, parseSource, staticText, walk } from './ts-source.js';

//---------------
// MCP request sites — which web endpoint (method + path) each MCP tool
// actually calls, read from the MCP sources.
//
// Web calls in the MCP go through `<client>.request(path, { method }, …)`,
// or a raw `fetch(`${client.baseUrl}${path}`, { method })` for binary bodies.
// A tool reaches an endpoint when its server.tool(...) registration calls,
// directly or through named functions/methods of apps/mcp/src, a request
// site with that method and path. This is what makes an ENDPOINT_TOOLS
// mapping (or an exclusion pointing at a mapped endpoint) a checked claim
// instead of a label: mapping GET /api/metrics to list_personas fails.
//
// Resolution is by name: a plain call `foo()` resolves to top-level
// functions named foo, a property call `x.foo()` to class methods named foo.
//---------------

export interface RequestSite {
  method: string;
  /** Path with each `${…}` as `{}` and the query string removed. */
  path: string;
}

interface Unit {
  node: ts.Node;
  sites: RequestSite[];
  plainCalls: Set<string>;
  memberCalls: Set<string>;
}

export interface McpCallGraph {
  /** Registered tool name → the request sites it reaches. */
  toolSites: Map<string, RequestSite[]>;
  /** Tool names in registration order. */
  tools: string[];
}

/** `const name = <literal>` declared in the function enclosing `from`. */
function localLiteral(from: ts.Node, name: string): string | null {
  let scope: ts.Node | undefined = from.parent;
  while (scope !== undefined && !ts.isFunctionLike(scope)) scope = scope.parent;
  if (scope === undefined) return null;
  let found: string | null = null;
  walk(scope, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const
    ) {
      found = staticText(node.initializer);
    }
  });
  return found;
}

/**
 * Normalizes a request path: drops the query string, and a trailing `{}`
 * glued to a non-slash character (`/api/x${query}`), which is a query
 * suffix, not a path segment.
 */
export function normalizePath(raw: string): string {
  const query = raw.indexOf('?');
  let path = query === -1 ? raw : raw.slice(0, query);
  while (path.endsWith('{}') && path.length > 2 && path[path.length - 3] !== '/') {
    path = path.slice(0, -2);
  }
  return path;
}

/**
 * The path of a raw `fetch(`${<x>.baseUrl}…`, …)` call: the text after the
 * base-URL span, where a lone `${name}` resolves to a local const.
 */
function fetchPath(call: ts.CallExpression): string | null {
  const url = call.arguments[0];
  if (!ts.isTemplateExpression(url) || url.head.text !== '') return null;
  const [base, ...rest] = url.templateSpans;
  if (!ts.isPropertyAccessExpression(base.expression) || base.expression.name.text !== 'baseUrl') return null;
  if (rest.length === 1 && base.literal.text === '' && rest[0].literal.text === '' && ts.isIdentifier(rest[0].expression)) {
    return localLiteral(call, rest[0].expression.text);
  }
  let text = base.literal.text;
  for (const span of rest) text += `{}${span.literal.text}`;
  return text;
}

function siteOf(call: ts.CallExpression): RequestSite | null {
  const isRequest = ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'request';
  const isFetch = ts.isIdentifier(call.expression) && call.expression.text === 'fetch';
  if ((!isRequest && !isFetch) || call.arguments.length < 2) return null;
  const first = call.arguments[0];
  const raw = isFetch
    ? fetchPath(call)
    : ts.isIdentifier(first)
      ? localLiteral(call, first.text)
      : staticText(first);
  const options = call.arguments[1];
  if (raw === null || !raw.startsWith('/api/') || !ts.isObjectLiteralExpression(options)) return null;
  let method: string | null = null;
  for (const prop of options.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'method') {
      method = staticText(prop.initializer);
    }
  }
  if (method === null) return null;
  return { method, path: normalizePath(raw) };
}

function unitOf(node: ts.Node): Unit {
  const unit: Unit = { node, sites: [], plainCalls: new Set(), memberCalls: new Set() };
  walk(node, (child) => {
    if (!ts.isCallExpression(child)) return;
    const site = siteOf(child);
    if (site !== null) unit.sites.push(site);
    const name = calleeName(child);
    if (name === null) return;
    if (ts.isIdentifier(child.expression)) unit.plainCalls.add(name);
    else unit.memberCalls.add(name);
  });
  return unit;
}

export function buildMcpCallGraph(files: ReadonlyArray<{ file: string; text: string }>, indexFile: string): McpCallGraph {
  const functions = new Map<string, Unit[]>();
  const methods = new Map<string, Unit[]>();
  const add = (map: Map<string, Unit[]>, name: string, node: ts.Node): void => {
    map.set(name, [...(map.get(name) ?? []), unitOf(node)]);
  };
  const registrations: Array<{ tool: string; node: ts.Node }> = [];

  for (const { file, text } of files) {
    const source = parseSource(file, text);
    walk(source, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
        add(functions, node.name.text, node.body);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        add(functions, node.name.text, node.initializer);
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body !== undefined) {
        add(methods, node.name.text, node.body);
      }
      if (
        file === indexFile &&
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'tool' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'server' &&
        node.arguments.length > 0
      ) {
        const tool = staticText(node.arguments[0]);
        if (tool !== null) registrations.push({ tool, node: node.arguments[node.arguments.length - 1] });
      }
    });
  }

  const toolSites = new Map<string, RequestSite[]>();
  for (const { tool, node } of registrations) {
    const seen = new Set<Unit>();
    const queue: Unit[] = [unitOf(node)];
    const sites: RequestSite[] = [];
    while (queue.length > 0) {
      const unit = queue.shift();
      if (unit === undefined || seen.has(unit)) continue;
      seen.add(unit);
      sites.push(...unit.sites);
      for (const name of unit.plainCalls) queue.push(...(functions.get(name) ?? []));
      for (const name of unit.memberCalls) queue.push(...(methods.get(name) ?? []));
    }
    toolSites.set(tool, sites);
  }
  return { toolSites, tools: registrations.map((r) => r.tool) };
}

/** `GET /api/posts/[id]` → `{ method: 'GET', path: '/api/posts/{}' }`. */
export function endpointSite(key: string): RequestSite {
  const [method, ...rest] = key.split(' ');
  const path = rest
    .join(' ')
    .split('/')
    .map((segment) => (segment.startsWith('[') && segment.endsWith(']') ? '{}' : segment))
    .join('/');
  return { method, path };
}

export function toolCallsEndpoint(graph: McpCallGraph, tool: string, key: string): boolean {
  const wanted = endpointSite(key);
  return (graph.toolSites.get(tool) ?? []).some(
    (site) => site.method === wanted.method && site.path === wanted.path,
  );
}
