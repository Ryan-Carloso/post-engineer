import ts from 'typescript';

//---------------
// TypeScript AST helpers for the parity verifier.
//
// The verifier reads route and MCP sources as syntax trees instead of
// matching regexes over raw text, so comments never count as code and a
// string literal is only ever seen as data (issue: a `requireSupabaseSession()`
// written in a comment used to satisfy the session-only check).
//---------------

export function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Every node under `root` (root included), depth first. */
export function walk(root: ts.Node, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  step(root);
}

/**
 * Static text of a string or template literal, with each `${…}` span
 * replaced by `{}`. Null for any other node.
 */
export function staticText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += `{}${span.literal.text}`;
    return text;
  }
  return null;
}

/** The name a call expression invokes: `foo()` → foo, `a.b.foo()` → foo. */
export function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** `a.b.c` → ['a', 'b', 'c'] for an identifier/property-access chain. */
export function accessChain(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const head = accessChain(node.expression);
    return head === null ? null : [...head, node.name.text];
  }
  if (ts.isCallExpression(node) || ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) {
    // `(await createClient()).auth.getUser()` — the chain continues past a call.
    return [];
  }
  return null;
}

export type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

/**
 * Top-level named functions of a file: `function f() {}` and
 * `const f = (…) => …` / `const f = function …`.
 */
export function topLevelFunctions(source: ts.SourceFile): Map<string, FunctionLike> {
  const out = new Map<string, FunctionLike>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      out.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer !== undefined &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          out.set(decl.name.text, decl.initializer);
        }
      }
    }
  }
  return out;
}

/** Top-level `const NAME = 'literal'` bindings of a file. */
export function topLevelStringConsts(source: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
      if (ts.isStringLiteral(decl.initializer)) out.set(decl.name.text, decl.initializer.text);
    }
  }
  return out;
}

/**
 * The nodes reachable from `entry` inside one file: the entry itself plus
 * every top-level function of the same file it calls by name, transitively.
 * Calls into other modules are not followed here.
 */
export function reachableLocalNodes(entry: ts.Node, locals: Map<string, FunctionLike>): ts.Node[] {
  const seen = new Set<ts.Node>([entry]);
  const queue: ts.Node[] = [entry];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    walk(node, (child) => {
      if (!ts.isCallExpression(child) || !ts.isIdentifier(child.expression)) return;
      const target = locals.get(child.expression.text);
      if (target !== undefined && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    });
  }
  return [...seen];
}

/** Whether `node` contains a `return` whose expression mentions `status` as a numeric literal. */
export function returnsStatus(node: ts.Node, status: number): boolean {
  let found = false;
  walk(node, (child) => {
    if (found || !ts.isReturnStatement(child) || child.expression === undefined) return;
    walk(child.expression, (inner) => {
      if (ts.isNumericLiteral(inner) && Number(inner.text) === status) found = true;
    });
  });
  return found;
}
