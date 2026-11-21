#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = 'apps/web/';
const SOURCE_FILE = /\.(ts|tsx)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test|tests|cypress|node_modules)\/|\.(test|spec|cy)\.[a-z]+$|\.gen\.[a-z]+$/;
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[a-z]+$/;
const SESSION_EXPIRY_MODULE = 'apps/web/lib/session-expiry.ts';
const CALL_SITE = /notifyIfSessionExpired\s*\(/;
const MAX_IMPORT_DEPTH = 3;
const IMPORT_FROM = /import\s+(?!type\b)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/g;
const IMPORT_SIDE_EFFECT = /import\s+['"]([^'"]+)['"]/g;
const IMPORT_DYNAMIC = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_CALL = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const ASSERTS_401 = /401/;
const ASSERTS_REDIRECT = /notifyIfSessionExpired|handleSessionExpiredError|\/login\?next=/;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function dirnamePosix(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function normalizePosix(path) {
  const parts = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

export function parseImports(text) {
  const specifiers = [];
  for (const pattern of [IMPORT_FROM, IMPORT_SIDE_EFFECT, IMPORT_DYNAMIC, REQUIRE_CALL]) {
    for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

export function resolveSpecifier(fromPath, specifier, knownFiles) {
  let base = null;
  if (specifier.startsWith('@/')) base = `${WEB_ROOT}${specifier.slice(2)}`;
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = normalizePosix(`${dirnamePosix(fromPath)}/${specifier}`);
  if (base === null) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

export function isCheckedFile(path) {
  return path.startsWith(WEB_ROOT) && SOURCE_FILE.test(path) && !NOT_PRODUCTION.test(path);
}

export function isTestFile(path) {
  return path.startsWith(WEB_ROOT) && SOURCE_FILE.test(path) && TEST_FILE.test(path);
}

export function buildImportGraph(files) {
  const knownFiles = new Set(files.map(({ path }) => path));
  const graph = new Map();
  for (const { path, text } of files) {
    if (!path.startsWith(WEB_ROOT) || !SOURCE_FILE.test(path)) continue;
    const targets = new Set();
    for (const specifier of parseImports(text)) {
      const resolved = resolveSpecifier(path, specifier, knownFiles);
      if (resolved !== null) targets.add(resolved);
    }
    graph.set(path, targets);
  }
  return graph;
}

export function importClosure(graph, start) {
  const seen = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth < MAX_IMPORT_DEPTH; depth += 1) {
    const next = [];
    for (const file of frontier) {
      for (const target of graph.get(file) ?? []) {
        if (!seen.has(target)) {
          seen.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

function testAssertsSessionExpiry(text) {
  return ASSERTS_401.test(text) && ASSERTS_REDIRECT.test(text);
}

export function findViolations(files) {
  const graph = buildImportGraph(files);
  const tests = files.filter(({ path }) => isTestFile(path));
  const closures = new Map(tests.map(({ path }) => [path, importClosure(graph, path)]));
  const violations = [];
  for (const { path, text } of files) {
    if (!isCheckedFile(path) || path === SESSION_EXPIRY_MODULE) continue;
    const callIndex = text.search(CALL_SITE);
    if (callIndex === -1) continue;
    const covered = tests.some(({ path: testPath, text: testText }) => {
      if (!closures.get(testPath).has(path)) return false;
      return testAssertsSessionExpiry(testText);
    });
    if (!covered) {
      violations.push({
        file: path,
        line: lineOf(text, callIndex),
        message: 'calls notifyIfSessionExpired but no test in its import closure asserts the 401 session-expiry behavior (PR #704)',
      });
    }
  }
  return violations;
}

export function listTrackedFiles(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

export async function run(root) {
  const files = listTrackedFiles(root)
    .filter((path) => path.startsWith(WEB_ROOT) && SOURCE_FILE.test(path))
    .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
  return findViolations(files);
}

function escapeAnnotation(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

async function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const violations = await run(root);
  for (const { file, line, message } of violations) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error file=${escapeAnnotation(file)},line=${line}::${escapeAnnotation(message)}`);
    else console.log(`${file}:${line} ${message}`);
  }
  if (violations.length > 0) {
    console.log(`session-expiry: ${violations.length} violation(s).`);
    process.exitCode = 1;
  } else {
    console.log('session-expiry: clean.');
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((error) => {
    console.error(`session-expiry failed: ${error.message}`);
    process.exitCode = 1;
  });
}
