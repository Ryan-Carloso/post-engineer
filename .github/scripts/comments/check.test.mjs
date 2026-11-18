import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findComments } from './scan.mjs';
import { stripComments } from './strip.mjs';
import { isExempt } from './check.mjs';

const strip = (text, file) => stripComments(text, findComments(text, file));

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
