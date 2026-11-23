import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../../apps/web/package.json', import.meta.url)));
const ts = require('typescript');

export const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const LIMITER = 'applyRateLimit';
export const PROFILES = 'RATE_LIMITS';

function isFunctionLike(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

function hasExport(node) {
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function collectLocals(source) {
  const locals = new Map();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      locals.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          locals.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return locals;
}

function collectExports(source) {
  const exported = [];
  for (const statement of source.statements) {
    if (!hasExport(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && HTTP_METHODS.includes(statement.name.text)) {
      exported.push({ method: statement.name.text, node: statement });
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.includes(declaration.name.text)) {
          exported.push({ method: declaration.name.text, node: declaration.initializer ?? declaration });
        }
      }
    }
  }
  return exported;
}

function isProfileReference(node) {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === PROFILES;
}

function reachesLimiter(root, locals) {
  const visited = new Set();
  const queue = [root];
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === LIMITER) {
        found = true;
        return;
      }
      if (node.arguments.some(isProfileReference)) {
        found = true;
        return;
      }
    }
    if (ts.isIdentifier(node) && locals.has(node.text)) {
      const target = locals.get(node.text);
      if (!visited.has(target)) queue.push(target);
    }
    ts.forEachChild(node, visit);
  };
  while (queue.length > 0 && !found) {
    const next = queue.shift();
    if (visited.has(next)) continue;
    visited.add(next);
    if (isFunctionLike(next) && next.body !== undefined) ts.forEachChild(next.body, visit);
    else visit(next);
  }
  return found;
}

export function scanRoute(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const locals = collectLocals(source);
  return collectExports(source).map(({ method, node }) => ({
    file,
    method,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    limited: reachesLimiter(node, locals),
  }));
}
