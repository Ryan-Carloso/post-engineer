import ts from 'typescript';
import { calleeName, parseSource, staticText, walk } from './ts-source.js';

export interface RequestSite {
  method: string;
  path: string;
}

interface Unit {
  node: ts.Node;
  sites: RequestSite[];
  plainCalls: Set<string>;
  memberCalls: Set<string>;
}

export interface McpCallGraph {
  toolSites: Map<string, RequestSite[]>;
  toolActions: Map<string, Map<string, RequestSite[]>>;
  tools: string[];
}

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

export function normalizePath(raw: string): string {
  const query = raw.indexOf('?');
  let path = query === -1 ? raw : raw.slice(0, query);
  while (path.endsWith('{}') && path.length > 2 && path[path.length - 3] !== '/') {
    path = path.slice(0, -2);
  }
  return path;
}

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

function actionHandlers(callback: ts.Expression): Array<{ action: string; node: ts.Node }> | null {
  if (!ts.isCallExpression(callback) || !ts.isIdentifier(callback.expression) || callback.expression.text !== 'byAction') return null;
  const map = callback.arguments[0];
  if (map === undefined || !ts.isObjectLiteralExpression(map)) return null;
  const actions: Array<{ action: string; node: ts.Node }> = [];
  for (const prop of map.properties) {
    const name = prop.name === undefined ? null : ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (name === null) continue;
    if (ts.isPropertyAssignment(prop)) actions.push({ action: name, node: prop.initializer });
    else if (ts.isShorthandPropertyAssignment(prop)) actions.push({ action: name, node: prop.name });
    else if (ts.isMethodDeclaration(prop) && prop.body !== undefined) actions.push({ action: name, node: prop.body });
  }
  return actions;
}

export function buildMcpCallGraph(files: ReadonlyArray<{ file: string; text: string }>): McpCallGraph {
  const functions = new Map<string, Unit[]>();
  const methods = new Map<string, Unit[]>();
  const add = (map: Map<string, Unit[]>, name: string, node: ts.Node): void => {
    map.set(name, [...(map.get(name) ?? []), unitOf(node)]);
  };
  const registrations: Array<{ tool: string; node: ts.Node }> = [];
  const actionRegistrations: Array<{ tool: string; actions: Array<{ action: string; node: ts.Node }> }> = [];

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
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'tool' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'server' &&
        node.arguments.length > 0
      ) {
        const tool = staticText(node.arguments[0]);
        if (tool === null) return;
        const callback = node.arguments[node.arguments.length - 1];
        const actions = actionHandlers(callback);
        if (actions === null) registrations.push({ tool, node: callback });
        else actionRegistrations.push({ tool, actions });
      }
    });
  }

  const sitesFrom = (node: ts.Node): RequestSite[] => {
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
    return sites;
  };

  const toolSites = new Map<string, RequestSite[]>();
  const toolActions = new Map<string, Map<string, RequestSite[]>>();
  for (const { tool, node } of registrations) toolSites.set(tool, sitesFrom(node));
  for (const { tool, actions } of actionRegistrations) {
    const bySite = new Map<string, RequestSite[]>();
    for (const { action, node } of actions) {
      const sites = ts.isIdentifier(node)
        ? (functions.get(node.text) ?? []).flatMap((unit) => sitesFrom(unit.node))
        : sitesFrom(node);
      bySite.set(action, sites);
    }
    toolActions.set(tool, bySite);
    toolSites.set(tool, [...bySite.values()].flat());
  }
  return { toolSites, toolActions, tools: [...registrations.map((r) => r.tool), ...actionRegistrations.map((r) => r.tool)] };
}

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

export function toolActionCallsEndpoint(graph: McpCallGraph, tool: string, action: string, key: string): boolean {
  const wanted = endpointSite(key);
  return (graph.toolActions.get(tool)?.get(action) ?? []).some(
    (site) => site.method === wanted.method && site.path === wanted.path,
  );
}
