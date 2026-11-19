#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMentionIndex } from './mentions.mjs';
import { violationOf } from './rules.mjs';
import { scanTs } from './scan-ts.mjs';

export const HOME = 'shared/contracts/providers.ts';
export const MIRRORS = ['apps/engine/app/providers.py', 'integrations/apify/src/post-engineer.js'];

const TS_ROOTS = ['apps/web/', 'apps/mcp/src/', 'shared/', 'scripts/', 'integrations/apify/src/'];
const TS_SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const PY_ROOTS = ['apps/engine/app/'];
const NOT_PRODUCTION = /(^|\/)(__tests__|test|tests|cypress|node_modules)\/|\.(test|spec|cy)\.[a-z]+$|\.gen\.[a-z]+$/;

export function selectSources(paths) {
  const production = paths.filter((path) => !NOT_PRODUCTION.test(path));
  return {
    ts: production.filter((path) => TS_ROOTS.some((root) => path.startsWith(root)) && TS_SOURCE.test(path)),
    py: production.filter((path) => PY_ROOTS.some((root) => path.startsWith(root)) && path.endsWith('.py')),
  };
}

export async function loadProviders(root) {
  const module = await import(pathToFileURL(join(root, HOME)).href);
  const providers = module.SOCIAL_PROVIDERS;
  const subsets = {};
  for (const [name, value] of Object.entries(module)) {
    if (name === 'SOCIAL_PROVIDERS' || !Array.isArray(value) || value.length === 0) continue;
    if (value.every((item) => providers.includes(item))) subsets[name] = value;
  }
  return { providers, subsets, columns: module.SCHEDULE_ACCOUNT_COLUMNS };
}

export function scanPython(root, files, index) {
  if (files.length === 0) return [];
  const dir = mkdtempSync(join(tmpdir(), 'provider-lists-'));
  try {
    const indexFile = join(dir, 'mentions.json');
    writeFileSync(indexFile, JSON.stringify(Object.fromEntries(index)));
    const script = fileURLToPath(new URL('./scan_python.py', import.meta.url));
    const output = execFileSync('python3', ['-I', script, indexFile, ...files], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function findViolations(groups, { providers, subsets }, mirrors = MIRRORS) {
  const violations = [];
  const seen = new Set();
  for (const group of groups) {
    const home = group.file === HOME || mirrors.includes(group.file);
    const message = violationOf(group, { providers, subsets, home });
    const key = `${group.file}:${group.line}:${message}`;
    if (message !== null && !seen.has(key)) {
      seen.add(key);
      violations.push({ file: group.file, line: group.line, message });
    }
  }
  const full = [...providers].sort().join(',');
  for (const mirror of mirrors) {
    const copies = groups.filter((group) => group.file === mirror && group.kind === 'list');
    if (!copies.some((group) => [...new Set(group.providers)].sort().join(',') === full)) {
      violations.push({ file: mirror, line: 1, message: `mirror of SOCIAL_PROVIDERS does not list exactly: ${providers.join(', ')}` });
    }
  }
  return violations;
}

export async function run(root) {
  const loaded = await loadProviders(root);
  const index = buildMentionIndex(loaded.providers, loaded.columns);
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const sources = selectSources(tracked);
  const groups = [
    ...sources.ts.flatMap((file) => scanTs(file, readFileSync(join(root, file), 'utf8'), index)),
    ...scanPython(root, sources.py, index),
  ];
  return findViolations(groups, loaded);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const violations = await run(root);
  for (const { file, line, message } of violations) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error file=${file},line=${line}::${message}`);
    else console.log(`${file}:${line} ${message}`);
  }
  if (violations.length > 0) {
    console.log(`\nprovider-lists: ${violations.length} violation(s). The one list is ${HOME}.`);
    process.exit(1);
  }
  console.log('provider-lists: clean.');
}
