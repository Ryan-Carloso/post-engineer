import ts from 'typescript';
import { z } from 'zod';
import {
  BEARER_MARKERS,
  readsBearerHeader,
  rejectsFlag,
  type HandlerFacts,
  type RouteFile,
} from './route-facts.js';
import { endpointSite, toolCallsEndpoint, type McpCallGraph } from './mcp-calls.js';
import { accessChain, calleeName, parseSource, reachableLocalNodes, staticText, topLevelFunctions, walk } from './ts-source.js';

//---------------
// Typed parity exclusions and their mechanical checks.
//
// Every exclusion is one of these kinds; there is no free-text kind. Each
// check reads the route's syntax tree (route-facts.ts), per exported
// handler, so comments and string contents never satisfy a check and one
// handler cannot vouch for another.
//
// - session-only: only the browser cookie session authenticates. The
//   handler calls requireSupabaseSession() with no argument or
//   <client>.auth.getUser(); it never calls requireSupabaseSession(request),
//   never reads the authorization/x-api-key header, and the file contains
//   no bearer marker (isApiKey, isOAuth, resolveApiKey, verifyAccessToken…).
// - bearer-rejected: the handler resolves bearers (requireSupabaseSession
//   with the request) and has `if (… .isApiKey === true …) return 403` and
//   the same for isOAuth (credential management stays off bearers).
// - secret-auth: the only gate is a shared secret, proven per mechanism:
//   cron-secret → `const r = rejectUnauthorizedCron(request, …)` returned
//   when non-null; engine-secret → reads the x-engine-secret header and
//   gates on secretsMatch(); stripe-signature → reads the stripe-signature
//   header and calls webhooks.constructEvent(). No session, no bearer.
// - oauth-redirect: a */start or */callback browser OAuth route that calls
//   oauthPopupResponse or setOAuthNonceCookie; no bearer handling.
// - ops-public: listed in the reviewed opsPublic list; no session, no
//   bearer marker, no bearer header read.
// - returned-url: the endpoint is only reached through a URL that a mapped
//   endpoint returns. The referenced endpoint must be mapped to a tool that
//   calls it, its handler must call an imported lib function whose source
//   builds this endpoint's path, and this route must accept bearers
//   (requireSupabaseSession(request)) so an MCP agent can open the URL.
// - event-stream: an SSE twin of a polled endpoint. The handler answers
//   text/event-stream from an engine path ending in /events; the polled
//   endpoint must be mapped to a tool that calls it, and its handler must
//   fetch the same engine path without /events.
//---------------

export const ExclusionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session-only') }).strict(),
  z.object({ kind: z.literal('bearer-rejected') }).strict(),
  z
    .object({
      kind: z.literal('secret-auth'),
      mechanism: z.enum(['cron-secret', 'engine-secret', 'stripe-signature']),
    })
    .strict(),
  z.object({ kind: z.literal('oauth-redirect') }).strict(),
  z.object({ kind: z.literal('ops-public') }).strict(),
  z.object({ kind: z.literal('returned-url'), endpoint: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('event-stream'), polledBy: z.string().min(1) }).strict(),
]);

export type Exclusion = z.infer<typeof ExclusionSchema>;

export const ParityDataSchema = z
  .object({
    opsPublic: z.array(z.string().min(1)),
    exclusions: z.record(z.string(), ExclusionSchema),
  })
  .strict();

export type ParityData = z.infer<typeof ParityDataSchema>;

export interface VerifyContext {
  /** Endpoint key → its route file and handler facts. */
  route: (key: string) => { route: RouteFile; handler: HandlerFacts } | undefined;
  /** Source text of a web module specifier such as '@/lib/video-urls', or undefined. */
  libSource: (specifier: string) => string | undefined;
  /** Source for imports reachable from a route; missing modules fail closed. */
  importSource?: (specifier: string, fromFile: string) => { file: string; text: string } | undefined;
  endpointTools: Readonly<Record<string, readonly string[]>>;
  graph: McpCallGraph;
  opsPublic: readonly string[];
}

function noSession(h: HandlerFacts): boolean {
  return h.sessionCallsNoArgs === 0 && h.sessionCallsWithArgs === 0 && h.getUserCalls === 0;
}

function noBearer(route: RouteFile, h: HandlerFacts): boolean {
  return route.fileBearerMarkers.length === 0 && h.bearerMarkers.length === 0 && !readsBearerHeader(h);
}

function importedBearerRisk(route: RouteFile, h: HandlerFacts, ctx: VerifyContext): string[] {
  if (ctx.importSource === undefined) return [];
  const found = new Set<string>();
  const queue: Array<{ specifier: string; fromFile: string; binding: string }> = [];
  for (const name of h.calls) {
    const specifier = route.imports.get(name);
    if (specifier !== undefined && !(name === 'requireSupabaseSession' && h.sessionCallsWithArgs === 0)) {
      queue.push({ specifier, fromFile: route.file, binding: name });
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    const resolved = ctx.importSource(item.specifier, item.fromFile);
    if (resolved === undefined || seen.has(`${resolved.file}:${item.binding}`)) continue;
    seen.add(`${resolved.file}:${item.binding}`);
    const source = parseSource(resolved.file, resolved.text);
    const locals = topLevelFunctions(source);
    const fn = locals.get(item.binding);
    if (fn === undefined) continue;
    const nodes = reachableLocalNodes(fn, locals);
    for (const root of nodes) walk(root, (node) => {
      if (ts.isIdentifier(node) && BEARER_MARKERS.includes(node.text as (typeof BEARER_MARKERS)[number])) found.add(node.text);
      if (!ts.isCallExpression(node)) return;
      const chain = accessChain(node.expression);
      if (chain?.slice(-2).join('.') === 'headers.get' && node.arguments[0] !== undefined) {
        const header = staticText(node.arguments[0])?.toLowerCase();
        if (header === 'authorization' || header === 'x-api-key' || header === undefined) found.add(`header:${header ?? 'dynamic'}`);
      }
    });
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        let invoked = false;
        for (const root of nodes) walk(root, (node) => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === element.name.text) invoked = true;
        });
        if (invoked) queue.push({ specifier: statement.moduleSpecifier.text, fromFile: resolved.file, binding: element.name.text });
      }
    }
  }
  return [...found].sort();
}

function mappedAndCalled(ctx: VerifyContext, key: string): string | null {
  const tools = ctx.endpointTools[key];
  if (tools === undefined || tools.length === 0) return `${key} is not mapped to an MCP tool in ENDPOINT_TOOLS`;
  const calling = tools.filter((tool) => toolCallsEndpoint(ctx.graph, tool, key));
  return calling.length > 0 ? null : `no tool mapped to ${key} calls it (${tools.join(', ')})`;
}

/** Violations of one exclusion; empty when the claim holds for the route. */
export function verifyExclusion(key: string, exclusion: Exclusion, ctx: VerifyContext): string[] {
  const found = ctx.route(key);
  if (found === undefined) return [`${key}: exclusion has no matching route handler`];
  const { route, handler: h } = found;
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(`${key}: ${message}`);
  };

  switch (exclusion.kind) {
    case 'session-only':
      need(h.sessionCallsWithArgs === 0, 'session-only handler must not call requireSupabaseSession(request) (it resolves API keys/OAuth tokens)');
      need(h.sessionCallsNoArgs + h.getUserCalls > 0, 'session-only handler must authenticate with requireSupabaseSession() or <client>.auth.getUser()');
      need(route.fileBearerMarkers.length === 0, `session-only route must contain no bearer handling (found ${route.fileBearerMarkers.join(', ')})`);
      need(!readsBearerHeader(h), 'session-only handler must not read the authorization/x-api-key header');
      need(importedBearerRisk(route, h, ctx).length === 0, `session-only handler must not reach an imported bearer helper (found ${importedBearerRisk(route, h, ctx).join(', ')})`);
      break;
    case 'bearer-rejected':
      need(h.sessionCallsWithArgs > 0, 'bearer-rejected handler must resolve bearers via requireSupabaseSession(request)');
      need(rejectsFlag(h, 'isApiKey', 403), 'bearer-rejected handler must `return …403` when auth.isApiKey === true');
      need(rejectsFlag(h, 'isOAuth', 403), 'bearer-rejected handler must `return …403` when auth.isOAuth === true');
      break;
    case 'secret-auth': {
      // Cron secrets intentionally arrive in Authorization: Bearer. Reject
      // API-key/OAuth markers and x-api-key imports, while allowing that
      // header when the typed mechanism is cron-secret.
      const importedSecretRisk = importedBearerRisk(route, h, ctx).filter(
        (marker) => !(exclusion.mechanism === 'cron-secret' && marker === 'header:authorization'),
      );
      need(noSession(h), 'secret-auth handler must not consult the session');
      need(noBearer(route, h), 'secret-auth handler must not handle bearer credentials');
      need(importedSecretRisk.length === 0, `secret-auth handler must not reach imported bearer handling (found ${importedSecretRisk.join(', ')})`);
      if (exclusion.mechanism === 'cron-secret') {
        need(returnsCronRejection(h), 'cron-secret handler must `const r = rejectUnauthorizedCron(request, …)` and `if (r !== null) return r;`');
      } else if (exclusion.mechanism === 'engine-secret') {
        need(h.headersRead.includes('x-engine-secret'), 'engine-secret handler must read the x-engine-secret header');
        need(h.calls.has('secretsMatch'), 'engine-secret handler must compare the secret with secretsMatch()');
      } else {
        need(h.headersRead.includes('stripe-signature'), 'stripe-signature handler must read the stripe-signature header');
        need(h.calls.has('constructEvent'), 'stripe-signature handler must verify with webhooks.constructEvent()');
      }
      break;
    }
    case 'oauth-redirect':
      need(/-(?:auth|oauth)\/(?:start|callback)$/.test(key), 'oauth-redirect only applies to a */start or */callback route');
      need(h.calls.has('oauthPopupResponse') || h.calls.has('setOAuthNonceCookie'), 'oauth-redirect handler must use oauthPopupResponse or setOAuthNonceCookie');
      need(noBearer(route, h) && h.sessionCallsWithArgs === 0, 'oauth-redirect handler must not handle bearer credentials');
      need(importedBearerRisk(route, h, ctx).length === 0, `oauth-redirect handler must not reach imported bearer handling (found ${importedBearerRisk(route, h, ctx).join(', ')})`);
      break;
    case 'ops-public':
      need(ctx.opsPublic.includes(key), 'ops-public is a closed list; the endpoint must be in opsPublic');
      need(noSession(h), 'ops-public handler must be unauthenticated');
      need(noBearer(route, h), 'ops-public handler must not handle bearer credentials');
      need(importedBearerRisk(route, h, ctx).length === 0, `ops-public handler must not reach imported bearer handling (found ${importedBearerRisk(route, h, ctx).join(', ')})`);
      break;
    case 'returned-url': {
      const mapping = mappedAndCalled(ctx, exclusion.endpoint);
      if (mapping !== null) errors.push(`${key}: ${mapping}`);
      need(h.sessionCallsWithArgs > 0, 'returned-url handler must accept bearers (requireSupabaseSession(request)) so the URL works for MCP callers');
      const referenced = ctx.route(exclusion.endpoint);
      const prefix = staticPrefix(key);
      need(
        referenced !== undefined && builtByImportedLib(referenced.route, referenced.handler, prefix, ctx),
        `${exclusion.endpoint} must call an imported lib function that builds ${prefix}… URLs`,
      );
      break;
    }
    case 'event-stream': {
      const mapping = mappedAndCalled(ctx, exclusion.polledBy);
      if (mapping !== null) errors.push(`${key}: ${mapping}`);
      need(h.strings.includes('text/event-stream'), 'event-stream handler must answer Content-Type text/event-stream');
      const streamPaths = h.strings.map(enginePath).filter((p): p is string => p !== null && p.endsWith('/events'));
      need(streamPaths.length > 0, 'event-stream handler must proxy an engine path ending in /events');
      const polled = ctx.route(exclusion.polledBy);
      const polledPaths = polled === undefined ? [] : polled.handler.strings.map(enginePath);
      need(
        streamPaths.some((p) => polledPaths.includes(p.slice(0, -'/events'.length))),
        `${exclusion.polledBy} must fetch the same engine resource without /events`,
      );
      break;
    }
  }
  return errors;
}

/** `GET /api/persona/video-download/[taskId]/[...path]` → `/api/persona/video-download/`. */
export function staticPrefix(key: string): string {
  const path = endpointSite(key).path;
  const cut = path.indexOf('{}');
  return cut === -1 ? path : path.slice(0, cut);
}

/** The engine path of a template like `{}/api/v1/tasks/{}/events`, else null. */
function enginePath(text: string): string | null {
  const at = text.indexOf('/api/v1/');
  return at === -1 ? null : text.slice(at);
}

function returnsCronRejection(h: HandlerFacts): boolean {
  // `const r = rejectUnauthorizedCron(request, …)` and an `if` on r
  // (`r !== null` or `r`) whose branch is `return r;`.
  const names = new Set<string>();
  for (const root of h.nodes) {
    walk(root, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        calleeName(node.initializer) === 'rejectUnauthorizedCron' &&
        node.initializer.arguments.length > 0 &&
        ts.isIdentifier(node.initializer.arguments[0])
      ) {
        names.add(node.name.text);
      }
    });
  }
  let guarded = false;
  for (const root of h.nodes) {
    walk(root, (node) => {
      if (!ts.isIfStatement(node)) return;
      const cond = node.expression;
      const tested =
        ts.isIdentifier(cond)
          ? cond.text
          : ts.isBinaryExpression(cond) &&
              cond.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
              ts.isIdentifier(cond.left) &&
              cond.right.kind === ts.SyntaxKind.NullKeyword
            ? cond.left.text
            : null;
      if (tested === null || !names.has(tested)) return;
      const then = ts.isBlock(node.thenStatement) ? node.thenStatement.statements[0] : node.thenStatement;
      if (
        then !== undefined &&
        ts.isReturnStatement(then) &&
        then.expression !== undefined &&
        ts.isIdentifier(then.expression) &&
        then.expression.text === tested
      ) {
        guarded = true;
      }
    });
  }
  return guarded;
}

function builtByImportedLib(route: RouteFile, h: HandlerFacts, prefix: string, ctx: VerifyContext): boolean {
  for (const name of h.calls) {
    const specifier = route.imports.get(name);
    if (specifier === undefined || !specifier.startsWith('@/lib/')) continue;
    const source = ctx.libSource(specifier);
    if (source !== undefined && libFunctionBuilds(source, name, prefix)) return true;
  }
  return false;
}

function libFunctionBuilds(text: string, name: string, prefix: string): boolean {
  const fn = topLevelFunctions(parseSource('lib.ts', text)).get(name);
  if (fn === undefined) return false;
  let found = false;
  walk(fn, (node) => {
    const literal = staticText(node);
    if (literal !== null && literal.startsWith(prefix)) found = true;
  });
  return found;
}
