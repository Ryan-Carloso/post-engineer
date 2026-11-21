import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyPy, classifyTs } from './directives.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ts = (text, file = 'a.ts') => classifyTs(text, file);
const py = (text, start = 10) => classifyPy(text, start);

test('a bare ts directive is its own bare form', () => {
  for (const text of [
    '// eslint-disable-next-line no-console',
    '/* eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element */',
    '// @ts-expect-error',
    '// @vitest-environment node',
    '/**\n * @vitest-environment node\n */',
    '/* @vite-ignore */',
    '/* webpackIgnore: true */',
    '// istanbul\u0020ignore next',
    '// Stryker disable next-line all',
    '// codeql[js/request-forgery]',
    '/// <reference types="vitest" />',
    '/* eslint-enable */',
  ]) {
    assert.deepEqual(ts(text), { bare: text, problem: null, detail: null }, text);
  }
});

test('prose after a ts directive is cut to the bare directive', () => {
  assert.equal(ts('// eslint-disable-next-line no-console -- debugging aid').bare, '// eslint-disable-next-line no-console');
  assert.equal(ts('/* eslint-disable-next-line @next/next/no-img-element -- arbitrary host */').bare, '/* eslint-disable-next-line @next/next/no-img-element */');
  assert.equal(ts('// @ts-expect-error -- the field is `name`, not `nome`').bare, '// @ts-expect-error');
  assert.equal(ts('// @vitest-environment node: drives the server SDK').bare, '// @vitest-environment node');
  assert.equal(ts('/**\n * @vitest-environment node\n * because the SDK needs it\n */').bare, '/** @vitest-environment node */');
  assert.equal(ts('// codeql[js/request-forgery]: false positive').bare, '// codeql[js/request-forgery]');
  assert.equal(ts('// Stryker disable next-line all: equivalent mutant').bare, '// Stryker disable next-line all');
  assert.equal(ts('// istanbul\u0020ignore next 3').bare, '// istanbul\u0020ignore next 3');
  assert.equal(ts('// Stryker disable next-line A, B: equivalent mutant').bare, '// Stryker disable next-line A, B');
});

test('a comment that only mentions a directive is a plain comment', () => {
  assert.equal(ts('// contract field makes this file fail typecheck. The @ts-expect-error'), null);
  assert.equal(ts('/** see the eslint-disable note and istanbul\u0020ignore below */'), null);
  assert.equal(ts('// `webpackIgnore: true` keeps the Node-only package out'), null);
  assert.equal(ts('// the codeql[js/request-forgery] alert is a false positive'), null);
});

test('blanket ts suppressions are reported', () => {
  assert.deepEqual(ts('// @ts-ignore'), { bare: '// @ts-ignore', problem: 'blanket', detail: '@ts-ignore' });
  assert.equal(ts('// @ts-nocheck').problem, 'blanket');
  assert.equal(ts('// eslint-disable-next-line').problem, 'blanket');
  assert.equal(ts('/* eslint-disable */').problem, 'blanket');
  assert.equal(ts('// eslint-disable-line -- no rule named').problem, 'blanket');
  assert.equal(ts('/* oxlint-disable-next-line */').problem, 'blanket');
});

test('suppressing a correctness rule is reported', () => {
  assert.deepEqual(ts('// eslint-disable-next-line react-hooks/exhaustive-deps'), {
    bare: '// eslint-disable-next-line react-hooks/exhaustive-deps',
    problem: 'correctness',
    detail: 'react-hooks/exhaustive-deps',
  });
  assert.equal(ts('// eslint-disable-next-line no-console, @typescript-eslint/no-unsafe-assignment').detail, '@typescript-eslint/no-unsafe-assignment');
  assert.equal(ts('// eslint-disable-next-line @typescript-eslint/no-explicit-any').problem, 'correctness');
  assert.equal(ts('/* eslint-enable react-hooks/exhaustive-deps */').problem, null);
});

test('js type tags keep their types and lose their descriptions', () => {
  assert.deepEqual(ts('/** @type {string[]} */', 'a.mjs'), { bare: '/** @type {string[]} */', problem: null, detail: null });
  assert.equal(
    ts('/**\n * Split on the first colon.\n * @param {string} text the input\n * @returns {[string, string]} key and rest\n */', 'a.mjs').bare,
    '/**\n * @param {string} text\n * @returns {[string, string]}\n */',
  );
  assert.equal(ts('/** @param {readonly string[]} providers @param {Record<string, string>} columns */', 'a.mjs').bare, '/** @param {readonly string[]} providers @param {Record<string, string>} columns */');
  assert.equal(ts('/** @param {number} input.shard 1-based */', 'a.mjs').bare, '/** @param {number} input.shard */');
  assert.equal(ts('/** @template T, U */', 'a.mjs').bare, '/** @template T, U */');
});

test('a multi-line js type keeps its inner indentation', () => {
  const doc = '  /**\n   * Load the config.\n   * @returns {{\n   *   apiPaths: string[],\n   * }}\n   */'.trimStart();
  assert.equal(ts(doc, 'a.mjs').bare, '/**\n   * @returns {{\n   *   apiPaths: string[],\n   * }}\n   */');
});

test('jsdoc without a type tag, or in a ts file, is a plain comment', () => {
  assert.equal(ts('/** Loads the config. @see config.yml */', 'a.mjs'), null);
  assert.equal(ts('/** @param name the name */', 'a.mjs'), null);
  assert.equal(ts('/** @type {string} */', 'a.ts'), null);
});

test('a bare python directive is its own bare form', () => {
  for (const text of ['# noqa: F401', '# noqa: E402,F401', '# type: ignore[arg-type]', '# pragma:\u0020no cover', '# fmt: off', '# codeql[py/full-ssrf]', '# pyright: ignore[reportGeneralTypeIssues]']) {
    assert.deepEqual(py(text), { bare: text, problem: null, detail: null }, text);
  }
  assert.deepEqual(py('#!/usr/bin/env python3', 0), { bare: '#!/usr/bin/env python3', problem: null, detail: null });
});

test('prose after a python directive is cut to the bare directive', () => {
  assert.equal(py('# noqa: BLE001 - telemetry must never break the request').bare, '# noqa: BLE001');
  assert.equal(py('# noqa: BLE001 — best-effort').bare, '# noqa: BLE001');
  assert.equal(py('# type: ignore[attr-defined] torch stubs lag').bare, '# type: ignore[attr-defined]');
  assert.equal(py('# pragma:\u0020no cover - defensive').bare, '# pragma:\u0020no cover');
  assert.equal(py('# codeql[py/full-ssrf]: guarded').bare, '# codeql[py/full-ssrf]');
  assert.equal(py('# noqa: F401  # type: ignore[attr-defined] - stubs').bare, '# noqa: F401  # type: ignore[attr-defined]');
});

test('a python comment that only mentions a directive is a plain comment', () => {
  assert.equal(py('# the noqa: F401 below re-exports'), null);
  assert.equal(py('# the codeql[py/full-ssrf] alert is guarded'), null);
  assert.equal(py('#!/usr/bin/env python3', 10), null);
});

test('blanket python suppressions are reported', () => {
  assert.deepEqual(py('# noqa'), { bare: '# noqa', problem: 'blanket', detail: 'noqa' });
  assert.equal(py('# noqa - whatever').problem, 'blanket');
  assert.equal(py('# type: ignore').problem, 'blanket');
  assert.equal(py('# pyright: ignore').problem, 'blanket');
  assert.equal(py('# ruff: noqa').problem, 'blanket');
});

test('suppressing a python correctness or safety check is reported', () => {
  assert.deepEqual(py('# noqa: F821'), { bare: '# noqa: F821', problem: 'correctness', detail: 'F821' });
  assert.equal(py('# noqa: E402, S603').detail, 'S603');
  assert.equal(py('# nosec').problem, 'correctness');
  assert.equal(py('# noqa: F401  # nosec').problem, 'correctness');
  assert.deepEqual(py('# nosec B101'), { bare: '# nosec B101', problem: 'correctness', detail: 'nosec' });
  assert.equal(py('# nosec B101, B102').bare, '# nosec B101, B102');
});

test('both eslint configs accept a bare @ts-expect-error', () => {
  for (const config of ['apps/web/eslint.config.mjs', 'apps/mcp/eslint.config.mjs']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, config), 'utf8');
    assert.ok(text.includes("'@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': false }]"), config);
  }
});
