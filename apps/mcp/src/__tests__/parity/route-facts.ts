import ts from 'typescript';
import {
  accessChain,
  calleeName,
  parseSource,
  reachableLocalNodes,
  staticText,
  topLevelFunctions,
  topLevelStringConsts,
  walk,
  type FunctionLike,
} from './ts-source.js';

//---------------
// Route facts — what each exported handler of a web route file actually
// does, read from the syntax tree.
//
// A handler is `export const METHOD = withApiErrorReporting(label, fn, …)`.
// Facts are collected per handler over the handler body plus every local
// function of the same file it calls (transitively), so one handler's auth
// check never vouches for another handler in the same file.
//---------------

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

// Anything that resolves or inspects a bearer credential (API key or MCP
// OAuth token). A session-only route must contain none of these anywhere.
export const BEARER_MARKERS = [
  'isApiKey',
  'isScopedApiKey',
  'isOAuth',
  'resolveApiKey',
  'validateApiKeyFormat',
  'verifyAccessToken',
  'resolveOAuthAccessToken',
  'personaIds',
] as const;

const BEARER_HEADERS = ['authorization', 'x-api-key'];

export interface HandlerFacts {
  method: string;
  label: string;
  /** requireSupabaseSession calls, by argument count. */
  sessionCallsNoArgs: number;
  sessionCallsWithArgs: number;
  /** `<x>.auth.getUser()` calls (cookie session via the server client). */
  getUserCalls: number;
  /** Bearer markers (identifiers/property names) in the reachable code. */
  bearerMarkers: string[];
  /** Header names read via `<x>.headers.get('<name>')`. */
  headersRead: string[];
  /** Names of every function/method called. */
  calls: Set<string>;
  /** Static text of every string/template literal. */
  strings: string[];
  /** The reachable nodes (handler + local helpers). */
  nodes: ts.Node[];
}

export interface RouteFile {
  file: string;
  source: ts.SourceFile;
  handlers: HandlerFacts[];
  /** Bearer markers anywhere in the file (imports included). */
  fileBearerMarkers: string[];
  /** Imported binding name → module specifier. */
  imports: Map<string, string>;
}

function importsOf(source: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        out.set(element.name.text, statement.moduleSpecifier.text);
      }
    }
  }
  return out;
}

function markersIn(nodes: readonly ts.Node[]): string[] {
  const found = new Set<string>();
  const markers: readonly string[] = BEARER_MARKERS;
  for (const root of nodes) {
    walk(root, (node) => {
      if (ts.isIdentifier(node) && markers.includes(node.text)) found.add(node.text);
    });
  }
  return [...found].sort();
}

function collectFacts(method: string, label: string, nodes: ts.Node[]): HandlerFacts {
  const facts: HandlerFacts = {
    method,
    label,
    sessionCallsNoArgs: 0,
    sessionCallsWithArgs: 0,
    getUserCalls: 0,
    bearerMarkers: markersIn(nodes),
    headersRead: [],
    calls: new Set(),
    strings: [],
    nodes,
  };
  for (const root of nodes) {
    walk(root, (node) => {
      const text = staticText(node);
      if (text !== null) facts.strings.push(text);
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name !== null) facts.calls.add(name);
      if (name === 'requireSupabaseSession') {
        if (node.arguments.length === 0) facts.sessionCallsNoArgs += 1;
        else facts.sessionCallsWithArgs += 1;
      }
      const chain = accessChain(node.expression);
      if (chain !== null && chain.length >= 2) {
        const tail = chain.slice(-2).join('.');
        if (tail === 'auth.getUser') facts.getUserCalls += 1;
        if (tail === 'headers.get' && node.arguments.length > 0) {
          const header = staticText(node.arguments[0]);
          facts.headersRead.push(header === null ? '<dynamic>' : header.toLowerCase());
        }
      }
    });
  }
  return facts;
}

/**
 * Parses one route file. Throws when an exported HTTP-method binding is not
 * a labelled withApiErrorReporting handler (it would be invisible to
 * discovery) or when the handler function cannot be resolved.
 */
export function readRouteFile(file: string, text: string): RouteFile {
  const source = parseSource(file, text);
  const locals = topLevelFunctions(source);
  const consts = topLevelStringConsts(source);
  const handlers: HandlerFacts[] = [];
  const methods: readonly string[] = HTTP_METHODS;

  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && methods.includes(statement.name.text)) {
      throw new Error(`${file}: ${statement.name.text} is exported as a plain function; wrap it in withApiErrorReporting('METHOD /api/…', handler) so parity discovery sees it`);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !methods.includes(decl.name.text)) continue;
      const method = decl.name.text;
      const init = decl.initializer;
      if (
        init === undefined ||
        !ts.isCallExpression(init) ||
        !ts.isIdentifier(init.expression) ||
        init.expression.text !== 'withApiErrorReporting' ||
        init.arguments.length < 2
      ) {
        throw new Error(`${file}: exported ${method} is not a withApiErrorReporting('METHOD /api/…', handler) call`);
      }
      const [labelArg, handlerArg] = init.arguments;
      const label = staticText(labelArg) ?? (ts.isIdentifier(labelArg) ? consts.get(labelArg.text) : undefined);
      if (label === undefined || label === null) {
        throw new Error(`${file}: exported ${method} handler has an unresolvable withApiErrorReporting label`);
      }
      let entry: FunctionLike | undefined;
      if (ts.isIdentifier(handlerArg)) entry = locals.get(handlerArg.text);
      else if (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg)) entry = handlerArg;
      if (entry === undefined) {
        throw new Error(`${file}: exported ${method} handler function could not be resolved in the file`);
      }
      handlers.push(collectFacts(method, label, reachableLocalNodes(entry, locals)));
    }
  }

  return {
    file,
    source,
    handlers,
    fileBearerMarkers: markersIn([source]),
    imports: importsOf(source),
  };
}

export function readsBearerHeader(facts: HandlerFacts): boolean {
  return facts.headersRead.some((h) => BEARER_HEADERS.includes(h) || h === '<dynamic>');
}

/**
 * Whether the handler has an `if` whose condition contains
 * `<x>.<flag> === true` and whose branch returns `status`.
 */
export function rejectsFlag(facts: HandlerFacts, flag: 'isApiKey' | 'isOAuth', status: number): boolean {
  let found = false;
  for (const root of facts.nodes) {
    walk(root, (node) => {
      if (found || !ts.isIfStatement(node)) return;
      let tests = false;
      walk(node.expression, (inner) => {
        if (
          ts.isBinaryExpression(inner) &&
          inner.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          ts.isPropertyAccessExpression(inner.left) &&
          inner.left.name.text === flag &&
          inner.right.kind === ts.SyntaxKind.TrueKeyword
        ) {
          tests = true;
        }
      });
      if (!tests) return;
      walk(node.thenStatement, (inner) => {
        if (!ts.isReturnStatement(inner) || inner.expression === undefined) return;
        walk(inner.expression, (leaf) => {
          if (ts.isNumericLiteral(leaf) && Number(leaf.text) === status) found = true;
        });
      });
    });
  }
  return found;
}
