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

test('removes whole-line and trailing ts comments', () => {
  const src = '// header\n\nconst a = 1; // trailing\n/** doc */\nexport function f() {\n  // inside\n  return a;\n}\n';
  assert.equal(strip(src, 'a.ts'), 'const a = 1;\nexport function f() {\n  return a;\n}\n');
});

test('keeps directives', () => {
  const src = '// @vitest-environment node\n// eslint-disable-next-line no-console\nconsole.log(1);\n// @ts-expect-error bad\nconst x: number = "";\n';
  assert.equal(strip(src, 'a.test.ts'), src);
});

test('keeps webpackIgnore and vite-ignore inside import()', () => {
  const src = 'await import(/* webpackIgnore: true */ "x");\nawait import(/* @vite-ignore */ p);\n';
  assert.equal(strip(src, 'a.ts'), src);
});

test('keeps a jsx directive sharing its wrapper with a note comment', () => {
  const src = 'const el = (\n  <div>\n    {/* eslint-disable-next-line */ /* note */}\n    <span />\n  </div>\n);\n';
  assert.equal(runFix('a.tsx', src), 'const el = (\n  <div>\n    {/* eslint-disable-next-line */ }\n    <span />\n  </div>\n);\n');
});

test('strips a prose comment that only mentions webpackIgnore', () => {
  const src = '// `webpackIgnore: true` so webpack does not try to bundle the Node-only\nconst a = 1;\n';
  assert.equal(runFix('a.ts', src), 'const a = 1;\n');
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

test('python: strips comments, keeps directives, shebang and strings', () => {
  const src = '#!/usr/bin/env python3\n# header\n\nimport os  # noqa: F401\nx = "# not"  # trailing\n# 😀 emoji\ny = 1\n';
  assert.equal(strip(src, 'a.py'), '#!/usr/bin/env python3\n\nimport os  # noqa: F401\nx = "# not"\ny = 1\n');
});

test('python: offsets stay aligned after non-BMP characters', () => {
  const src = 'a = "😀😀"  # one\nb = 2  # two\n';
  assert.equal(strip(src, 'a.py'), 'a = "😀😀"\nb = 2\n');
});

test('exempts generated, vendored and code-owned files', () => {
  assert.equal(isExempt('apps/web/lib/engine/schema.gen.ts'), true);
  assert.equal(isExempt('apps/mcp/src/__tests__/parity/verify.ts'), true);
  assert.equal(isExempt('apps/web/components/calendar.tsx'), true);
  assert.equal(isExempt('apps/web/lib/api.ts'), false);
});

test('keeps combined, regex and array webpack magic comments', () => {
  const src =
    'await import(/* webpackChunkName: "x", webpackPrefetch: true */ "a");\n' +
    'await import(/* webpackInclude: /\\.json$/ */ `./d/${n}`);\n' +
    'await import(/* webpackExports: ["a", "b"] */ "b");\n';
  assert.equal(runFix('a.ts', src), src);
});

test('keeps refresh, eslint-env, stylelint and tslint directives but strips prose that mentions them', () => {
  const kept = '// @refresh reset\n/* eslint-env node */\n/* stylelint-disable */\n// tslint:disable-next-line\nconst a = 1;\n';
  assert.equal(runFix('a.ts', kept), kept);
  assert.equal(runFix('b.ts', '// the @refresh reset trick and eslint-env\nconst a = 1;\n'), 'const a = 1;\n');
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
