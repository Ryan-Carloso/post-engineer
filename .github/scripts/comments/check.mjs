#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isVendoredCalendarCN } from '../file-size/vendored-calendarcn.mjs';
import { findComments, lineOf } from './scan.mjs';
import { stripComments } from './strip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|py)$/;

const CODE_OWNED = [
  'apps/mcp/src/__tests__/web-api-parity.test.ts',
  'apps/mcp/src/__tests__/parity-verifier.test.ts',
  'apps/mcp/src/__tests__/parity/',
  'apps/web/app/api/__tests__/parity-exclusion-bearer.test.ts',
  'apps/web/vitest.config.',
  'apps/mcp/vitest.config.',
  'apps/mcp/vite.config.',
  '.github/scripts/parity-exclusions/',
];

export function isExempt(p) {
  if (isVendoredCalendarCN(p)) return true;
  if (CODE_OWNED.some((owned) => p.startsWith(owned))) return true;
  if (/\.gen\.[^.]+$/.test(p)) return true;
  if (p.endsWith('next-env.d.ts')) return true;
  return p.split('/').includes('node_modules');
}

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [meta, file] = entry.split('\t');
      return { mode: meta.split(' ')[0], file };
    })
    .filter(({ mode, file }) => mode !== '120000' && SOURCE.test(file) && !isExempt(file))
    .map(({ file }) => file);
}

function parseArgs(argv) {
  const fix = argv.includes('--fix');
  const files = argv.filter((a) => !a.startsWith('--'));
  return { fix, files };
}

export function run(argv, root = REPO_ROOT, log = console.log) {
  const { fix, files } = parseArgs(argv);
  const targets = files.length > 0 ? files.filter((f) => SOURCE.test(f) && !isExempt(f)) : trackedFiles(root);
  let found = 0;
  let fixedFiles = 0;
  for (const file of targets) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const comments = findComments(text, file).filter((c) => !c.directive);
    if (comments.length === 0) continue;
    if (fix) {
      fs.writeFileSync(abs, stripComments(text, comments));
      fixedFiles++;
      continue;
    }
    for (const c of comments) {
      found++;
      const line = lineOf(text, c.start);
      const preview = c.text.split('\n')[0].slice(0, 100);
      log(process.env.GITHUB_ACTIONS === 'true' ? `::error file=${file},line=${line}::comment: ${preview}` : `${file}:${line}: ${preview}`);
    }
  }
  if (fix) {
    log(`comments: stripped comments from ${fixedFiles} file(s)`);
    return 0;
  }
  if (found > 0) {
    log(`comments: ${found} comment(s) found. Remove them, or run: node .github/scripts/comments/check.mjs --fix`);
    return 1;
  }
  log('comments: clean');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.slice(2)));
}
