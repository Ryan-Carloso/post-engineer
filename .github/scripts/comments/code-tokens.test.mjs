import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameCode } from './code-tokens.mjs';

test('line, block, trailing and JSDoc comments do not change the code', () => {
  const before = '// header\n/** Doc. */\nexport function f(a: number): number {\n  /* inline */ return a + 1; // trailing\n}\n';
  const after = 'export function f(a: number): number {\n  return a + 1;\n}\n';
  assert.equal(sameCode(before, after, 'a.ts'), true);
});

test('JSDoc on an interface member does not change the code', () => {
  const before = 'export interface B {\n  /** The PR. */\n  pr: number | null;\n}\n';
  const after = 'export interface B {\n  pr: number | null;\n}\n';
  assert.equal(sameCode(before, after, 'a.ts'), true);
});

test('a JSX comment expression and the whitespace it leaves do not change the code', () => {
  const before = 'const el = (\n  <div>\n    {/* note */}\n    <span>hi</span>\n  </div>\n);\n';
  const after = 'const el = (\n  <div>\n    <span>hi</span>\n  </div>\n);\n';
  assert.equal(sameCode(before, after, 'a.tsx'), true);
});

test('an operator change is a code change', () => {
  assert.equal(sameCode('const a = 1 + 2;\n', 'const a = 1 - 2;\n', 'a.ts'), false);
});

test('whitespace inside a string or template is a code change', () => {
  assert.equal(sameCode("const a = 'x  y';\n", "const a = 'x y';\n", 'a.ts'), false);
  assert.equal(sameCode('const a = `x  ${b}`;\n', 'const a = `x ${b}`;\n', 'a.ts'), false);
});

test('changed JSX text is a code change', () => {
  assert.equal(sameCode('const el = <p>Hello</p>;\n', 'const el = <p>Bye</p>;\n', 'a.tsx'), false);
});

test('comment-like text inside a regex is code', () => {
  assert.equal(sameCode('const r = /a\\/\\/b/;\n', 'const r = /a\\/\\/c/;\n', 'a.ts'), false);
});

test('removing a statement is a code change', () => {
  assert.equal(sameCode('f();\ng();\n', 'f();\n', 'a.ts'), false);
});

test('a line break that changes automatic semicolon insertion is a code change', () => {
  assert.equal(sameCode('function f() {\n  return value;\n}\n', 'function f() {\n  return\n  value;\n}\n', 'a.ts'), false);
  assert.equal(sameCode('a\n++b\n', 'a++\nb\n', 'a.ts'), false);
});

test('a rendered space between JSX elements is a code change, newline indentation is not', () => {
  assert.equal(sameCode('const el = <p><b>a</b> <b>b</b></p>;\n', 'const el = <p><b>a</b><b>b</b></p>;\n', 'a.tsx'), false);
  assert.equal(sameCode('const el = <p>\n  <b>a</b>\n  <b>b</b>\n</p>;\n', 'const el = <p><b>a</b><b>b</b></p>;\n', 'a.tsx'), true);
  assert.equal(sameCode('const el = <p>\n  hello\n  world\n</p>;\n', 'const el = <p>hello world</p>;\n', 'a.tsx'), true);
});
