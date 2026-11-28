import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findComments } from './scan.mjs';
import { stripComments } from './strip.mjs';
import { isExempt, run } from './check.mjs';

const strip = (text, file) => stripComments(text, findComments(text, file));

function runFixWithCode(file, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-'));
  try {
    fs.writeFileSync(path.join(dir, file), text);
    const logs = [];
    const code = run(['--fix', file], dir, (line) => logs.push(line));
    return { code, logs, text: fs.readFileSync(path.join(dir, file), 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runFix(file, text) {
  const result = runFixWithCode(file, text);
  assert.equal(result.code, 0);
  return result.text;
}

const TOOL_DIRECTIVES = [
  '// @vitest-environment node',
  '// eslint-disable-next-line no-console',
  '/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */',
  '// @ts-expect-error',
  '// @ts-ignore',
  '// codeql[js/request-forgery]',
  '/** @type {string} */',
  '// @refresh reset',
  '/* eslint-env node */',
  '/* istanbul ignore next */',
];

test('reports every tool directive as a comment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-'));
  try {
    TOOL_DIRECTIVES.forEach((directive, i) => fs.writeFileSync(path.join(dir, `d${i}.ts`), `${directive}\nconst a = 1;\n`));
    fs.writeFileSync(path.join(dir, 'p.py'), 'import os  # noqa: F401\nx = 1  # type: ignore[assignment]\n');
    const logs = [];
    const files = [...TOOL_DIRECTIVES.map((_, i) => `d${i}.ts`), 'p.py'];
    assert.equal(run(files, dir, (line) => logs.push(line)), 1);
    TOOL_DIRECTIVES.forEach((directive, i) => assert.ok(logs.includes(`d${i}.ts:1: comment: ${directive}`), directive));
    assert.ok(logs.includes('p.py:1: comment: # noqa: F401'));
    assert.ok(logs.includes('p.py:2: comment: # type: ignore[assignment]'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--fix strips directives, magic comments and suppressions like any other comment', () => {
  const src = '// @ts-ignore\nconst a: number = 1;\nawait import(/* webpackIgnore: true */ "x");\n// eslint-disable-next-line no-console\nconsole.log(a);\n';
  assert.equal(runFix('a.ts', src), 'const a: number = 1;\nawait import( "x");\nconsole.log(a);\n');
});

test('--fix removes a jsx directive with its braces', () => {
  const src = 'const el = (\n  <div>\n    {/* eslint-disable-next-line no-console */ /* note */}\n    <span />\n  </div>\n);\n';
  assert.equal(runFix('a.tsx', src), 'const el = (\n  <div>\n    <span />\n  </div>\n);\n');
});

test('removes whole-line and trailing ts comments', () => {
  const src = '// header\n\nconst a = 1; // trailing\n/** doc */\nexport function f() {\n  // inside\n  return a;\n}\n';
  assert.equal(strip(src, 'a.ts'), 'const a = 1;\nexport function f() {\n  return a;\n}\n');
});

test('leaves comment-like text inside strings, templates, regex and jsx text', () => {
  const src = 'const u = "http://x"; const t = `/* y */ ${u}`; const r = /\\/\\/z/;\nconst el = <a>// not a comment</a>;\n';
  assert.equal(strip(src, 'a.tsx'), src);
});

test('removes a jsx comment expression with its braces', () => {
  const src = 'const el = (\n  <div>\n    {/* note */}\n    <span />\n  </div>\n);\n';
  assert.equal(strip(src, 'a.tsx'), 'const el = (\n  <div>\n    <span />\n  </div>\n);\n');
});

test('inline block comments collapse without merging tokens', () => {
  assert.equal(strip('f(a, /* b */ c);\nconst /* x */y = 1;\n', 'a.ts'), 'f(a, c);\nconst y = 1;\n');
});

test('does not leave a blank line before a closing brace', () => {
  assert.equal(strip('function f() {\n  g();\n\n  // done\n}\n', 'a.ts'), 'function f() {\n  g();\n}\n');
});

test('python: strips comments, directives and the shebang, keeps strings', () => {
  const src = '#!/usr/bin/env python3\n# header\n\nimport os  # noqa: F401\nx = "# not"  # trailing\n# 😀 emoji\ny = 1\n';
  assert.equal(strip(src, 'a.py'), 'import os\nx = "# not"\ny = 1\n');
});

test('python: offsets stay aligned after non-BMP characters', () => {
  const src = 'a = "😀😀"  # one\nb = 2  # two\n';
  assert.equal(strip(src, 'a.py'), 'a = "😀😀"\nb = 2\n');
});

test('exempts generated and vendored files, and nothing code-owned', () => {
  assert.equal(isExempt('apps/web/lib/supabase/database.gen.ts'), true);
  assert.equal(isExempt('apps/mcp/src/__tests__/parity/verify.ts'), false);
  assert.equal(isExempt('apps/web/vitest.config.ts'), false);
  assert.equal(isExempt('apps/web/components/calendar-provider.tsx'), true);
  assert.equal(isExempt('apps/web/lib/api.ts'), false);
});

test('a multi-line comment after return keeps its line break, so the result is unchanged', () => {
  const src = 'return /* a\n b */ 1;\n';
  const fixed = runFix('a.js', src);
  assert.equal(fixed, 'return \n 1;\n');
  assert.equal(new Function(src)(), undefined);
  assert.equal(new Function(fixed)(), undefined);
});

test('a multi-line comment inside an expression keeps the expression value', () => {
  const src = 'return 1 /* a\n b */ + 2;\n';
  const fixed = runFix('a.js', src);
  assert.equal(new Function(fixed)(), new Function(src)());
});

test('--fix refuses to write a file when stripping would change the code', () => {
  const src = 'const el = <p>a{/* x */}b</p>;\n';
  const result = runFixWithCode('a.tsx', src);
  assert.equal(result.code, 1);
  assert.equal(result.text, src);
  assert.ok(result.logs.some((line) => line.includes('a.tsx: not fixed, stripping would change the code')));
});

test('--fix keeps the Python syntax tree and refuses a file it cannot parse', async () => {
  const { pySameAst } = await import('./scan.mjs');
  assert.equal(runFix('a.py', 'def f():\n    # note\n    return 1  # one\n'), 'def f():\n    return 1\n');
  assert.equal(pySameAst('x = 1\n', 'x = 2\n'), false);
  assert.equal(pySameAst('x = 1  # a\n', 'x = 1\n'), true);
  const unparseable = runFixWithCode('b.py', 'x = = 1  # note\n');
  assert.equal(unparseable.code, 1);
  assert.equal(unparseable.text, 'x = = 1  # note\n');
  assert.ok(unparseable.logs.some((line) => line.includes('b.py: not fixed, stripping would change the code')));
});

test('a file the tokenizer cannot read is reported and the run continues', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-'));
  try {
    fs.writeFileSync(path.join(dir, 'bad.py'), 'def f(:\n    pass  # note\n');
    fs.writeFileSync(path.join(dir, 'good.ts'), 'const a = 1; // note\n');
    const logs = [];
    const code = run(['bad.py', 'good.ts'], dir, (line) => logs.push(line));
    assert.equal(code, 1);
    assert.ok(logs.some((line) => line.startsWith('bad.py: could not be scanned')));
    assert.ok(logs.some((line) => line.includes('good.ts') && line.includes('// note')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findings are reported as GitHub annotations under GITHUB_ACTIONS and as file:line otherwise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-'));
  const previous = process.env.GITHUB_ACTIONS;
  try {
    fs.writeFileSync(path.join(dir, 'a.ts'), '// drives the server SDK\nconst a = 1;\n');
    process.env.GITHUB_ACTIONS = 'true';
    const ciLogs = [];
    assert.equal(run(['a.ts'], dir, (line) => ciLogs.push(line)), 1);
    assert.ok(ciLogs.some((line) => line === '::error file=a.ts,line=1::comment: // drives the server SDK'));
    delete process.env.GITHUB_ACTIONS;
    const plainLogs = [];
    assert.equal(run(['a.ts'], dir, (line) => plainLogs.push(line)), 1);
    assert.ok(plainLogs.some((line) => line === 'a.ts:1: comment: // drives the server SDK'));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
