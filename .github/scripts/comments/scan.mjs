import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

let tsModule = null;
function loadTypeScript() {
  if (tsModule === null) {
    const require = createRequire(path.join(REPO_ROOT, 'apps/web/package.json'));
    tsModule = require('typescript');
  }
  return tsModule;
}

const TS_DIRECTIVE =
  /eslint-(disable|enable)|^\s*\/[/*]\s*eslint\s|@ts-(expect-error|ignore|nocheck|check)|@(vitest|jest)-environment|webpack[A-Z]\w*\s*:|@vite-ignore|(istanbul|c8|v8) ignore|Stryker (disable|restore)|prettier-ignore|oxlint-(disable|enable)|[@#]__PURE__|codeql\[|lgtm\[|biome-ignore|@jsx|@license|@preserve|^\/\/\/\s*<(reference|amd)/;
const JS_TYPE_DIRECTIVE = /@(type|typedef|satisfies|template)\s*[{\s]|@param\s*\{|@returns?\s*\{/;

export function isTsDirective(commentText, file) {
  if (TS_DIRECTIVE.test(commentText)) return true;
  return /\.(c|m)?jsx?$/.test(file) && JS_TYPE_DIRECTIVE.test(commentText);
}

const PY_DIRECTIVE =
  /^#!|^#.*-\*-\s*coding|^#\s*(noqa|type:|pragma|fmt:|nosec|pyright:|mypy:|ruff:|isort:)|codeql\[|lgtm\[|#\s*noqa/;

export function isPyDirective(commentText) {
  return PY_DIRECTIVE.test(commentText);
}

function scriptKind(ts, file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(c|m)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function tsComments(text, file) {
  const ts = loadTypeScript();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const jsxTextSpans = [];
  const emptyJsxExpressions = [];
  const seen = new Map();
  const add = (ranges) => {
    if (ranges === undefined) return;
    for (const r of ranges) if (!seen.has(r.pos)) seen.set(r.pos, { start: r.pos, end: r.end });
  };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxTextSpans.push([node.pos, node.end]);
      return;
    }
    if (node.kind === ts.SyntaxKind.JsxExpression && node.expression === undefined) {
      emptyJsxExpressions.push([node.getStart(sf), node.end]);
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.pos));
      add(ts.getTrailingCommentRanges(text, node.end));
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  const insideJsxText = (pos) => jsxTextSpans.some(([s, e]) => pos >= s && pos < e);
  return [...seen.values()]
    .filter((c) => !insideJsxText(c.start))
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const body = text.slice(c.start, c.end);
      const wrapper = emptyJsxExpressions.find(([s, e]) => s < c.start && c.end <= e);
      return { ...c, text: body, directive: isTsDirective(body, file), jsxWrapper: wrapper ?? null };
    });
}

export function pyComments(text) {
  const out = execFileSync('python3', ['-I', path.join(HERE, 'py_comments.py')], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).map((c) => ({ ...c, directive: isPyDirective(c.text), jsxWrapper: null }));
}

export function lineOf(text, pos) {
  return text.slice(0, pos).split('\n').length;
}

export function findComments(text, file) {
  if (file.endsWith('.py')) return pyComments(text);
  return tsComments(text, file);
}
