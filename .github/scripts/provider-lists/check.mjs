#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMentionIndex } from './mentions.mjs';
import { violationOf } from './rules.mjs';
import { scanTs } from './scan-ts.mjs';

export const HOME = 'shared/contracts/providers.ts';

const TS_ROOTS = ['apps/web/', 'apps/mcp/src/', 'shared/', 'scripts/'];
const TS_SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test|tests|cypress|node_modules)\/|\.(test|spec|cy)\.[a-z]+$|\.gen\.[a-z]+$/;

export function selectSources(paths) {
  const production = paths.filter((path) => !NOT_PRODUCTION.test(path));
  return production.filter((path) => TS_ROOTS.some((root) => path.startsWith(root)) && TS_SOURCE.test(path));
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

export function findViolations(groups, { providers, subsets }) {
  const violations = [];
  const seen = new Set();
  for (const group of groups) {
    const message = violationOf(group, { providers, subsets, home: group.file === HOME });
    const key = `${group.file}:${group.line}:${message}`;
    if (message !== null && !seen.has(key)) {
      seen.add(key);
      violations.push({ file: group.file, line: group.line, message });
    }
  }
  return violations;
}

export async function run(root) {
  const loaded = await loadProviders(root);
  const index = buildMentionIndex(loaded.providers, loaded.columns);
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const groups = selectSources(tracked).flatMap((file) =>
    scanTs(file, readFileSync(join(root, file), 'utf8'), index),
  );
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
