#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isVendoredCalendarCN } from '../file-size/vendored-calendarcn.mjs';
import { isVendoredUiDiff } from '../file-size/vendored-uidiff.mjs';
import { findComments, lineOf, pySameAst } from './scan.mjs';
import { stripComments } from './strip.mjs';
import { sameCode } from './code-tokens.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|py)$/;

export function isExempt(p) {
  if (isVendoredCalendarCN(p)) return true;
  if (isVendoredUiDiff(p)) return true;
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

export function findings(text, file) {
  return findComments(text, file).map((c) => ({ c, message: `comment: ${c.text.split('\n')[0].slice(0, 100)}` }));
}

function fixFile(text, file) {
  const stripped = stripComments(text, findComments(text, file));
  const unchanged = file.endsWith('.py') ? pySameAst(text, stripped) : sameCode(text, stripped, file);
  return unchanged ? stripped : null;
}

export function run(argv, root = REPO_ROOT, log = console.log) {
  const { fix, files } = parseArgs(argv);
  const targets = files.length > 0 ? files.filter((f) => SOURCE.test(f) && !isExempt(f)) : trackedFiles(root);
  const report = (file, text, f) => {
    const line = lineOf(text, f.c.start);
    log(process.env.GITHUB_ACTIONS === 'true' ? `::error file=${file},line=${line}::${f.message}` : `${file}:${line}: ${f.message}`);
  };
  let found = 0;
  let fixedFiles = 0;
  let refused = 0;
  let unreadable = 0;
  for (const file of targets) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    let all;
    try {
      all = findings(text, file);
    } catch (error) {
      unreadable++;
      log(`${file}: could not be scanned: ${String(error.message).split('\n')[0]}`);
      continue;
    }
    if (all.length === 0) continue;
    if (fix) {
      const fixed = fixFile(text, file);
      if (fixed === null) {
        refused++;
        log(`${file}: not fixed, stripping would change the code; remove these comments by hand`);
        continue;
      }
      fs.writeFileSync(abs, fixed);
      fixedFiles++;
      continue;
    }
    for (const f of all) {
      found++;
      report(file, text, f);
    }
  }
  if (fix) {
    log(`comments: stripped comments from ${fixedFiles} file(s)`);
    return refused > 0 || unreadable > 0 ? 1 : 0;
  }
  if (found > 0 || unreadable > 0) {
    log(`comments: ${found} finding(s). Remove them, or run: node .github/scripts/comments/check.mjs --fix`);
    return 1;
  }
  log('comments: clean');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.slice(2)));
}
