import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPy, classifyTs } from './directives.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

let tsModule = null;
export function loadTypeScript() {
  if (tsModule === null) {
    const require = createRequire(path.join(REPO_ROOT, 'apps/web/package.json'));
    tsModule = require('typescript');
  }
  return tsModule;
}

function withVerdict(comment, found) {
  if (found === null) return { ...comment, directive: false, bare: null, problem: null, detail: null };
  return { ...comment, directive: true, ...found };
}

export function scriptKind(ts, file) {
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
      return withVerdict({ ...c, text: body, jsxWrapper: wrapper ?? null }, classifyTs(body, file));
    });
}

export function pyComments(text) {
  const out = execFileSync('python3', ['-I', path.join(HERE, 'py_comments.py')], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).map((c) => withVerdict({ ...c, jsxWrapper: null }, classifyPy(c.text, c.start)));
}

export function pySameAst(before, after) {
  const out = execFileSync('python3', ['-I', path.join(HERE, 'py_same_ast.py')], {
    input: JSON.stringify({ before, after }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out) === true;
}

export function lineOf(text, pos) {
  return text.slice(0, pos).split('\n').length;
}

export function findComments(text, file) {
  if (file.endsWith('.py')) return pyComments(text);
  return tsComments(text, file);
}
