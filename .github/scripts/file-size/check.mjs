#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isVendoredCalendarCN } from './vendored-calendarcn.mjs';
import { isPromptDataFile } from './prompt-data.mjs';

export const LINE_CAP = 500;

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return args;
}

export function isSourceFile(p) {
  return /\.(py|tsx?)$/.test(p);
}

export function isExempt(p) {
  if (isVendoredCalendarCN(p)) return true;
  // Prompt-data files: prompt wording is data, not logic — see prompt-data.mjs.
  if (isPromptDataFile(p)) return true;
  const segments = p.split('/');
  const base = segments[segments.length - 1];
  if (base.includes('.test.') || base.includes('_test.')) return true;
  if (segments.some((s) => s === 'test' || s === 'tests')) return true;
  if (segments[0] === 'supabase' && segments[1] === 'migrations') return true;
  if (base === 'pnpm-lock.yaml' || base === 'uv.lock' || base.endsWith('.lock')) return true;
  if (base.endsWith('.md')) return true;
  if (/\.gen\.[^.]+$/.test(base)) return true;
  return false;
}

export function countLines(text) {
  if (text.length === 0) return 0;
  const newlines = (text.match(/\n/g) || []).length;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

export function checkFile({ path: p, status, baseLines, headLines }) {
  if (!isSourceFile(p) || isExempt(p)) return null;
  const kind = status[0];
  if (kind === 'A') {
    if (headLines > LINE_CAP) {
      return `new file has ${headLines} lines, above the ${LINE_CAP}-line cap`;
    }
    return null;
  }
  if (kind === 'M' || kind === 'R' || kind === 'C' || kind === 'T') {
    if (headLines > LINE_CAP && headLines > baseLines) {
      const growth = ` (${baseLines} -> ${headLines} lines)`;
      const grandfathered = baseLines > LINE_CAP ? ' (grandfathered files may not grow)' : '';
      return `grew past the ${LINE_CAP}-line cap${growth}${grandfathered}`;
    }
    return null;
  }
  return null;
}

function escapeAnnotation(s) {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function gitShow(ref, filePath, repoRoot) {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function collectFromGit(base, head, repoRoot) {
  const raw = execFileSync(
    'git',
    ['diff', '--no-color', '--no-ext-diff', '--name-status', `${base}...${head}`, '--', '.'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const files = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    const kind = status[0];
    if (kind === 'D' || kind === 'U' || kind === 'X' || kind === 'B') continue;
    let filePath = parts[1];
    let oldPath = null;
    if (kind === 'R' || kind === 'C') {
      oldPath = parts[1];
      filePath = parts[2];
    }
    if (!isSourceFile(filePath) || isExempt(filePath)) continue;
    const headText = gitShow(head, filePath, repoRoot);
    if (headText === null) continue;
    const headLines = countLines(headText);
    let baseLines = 0;
    if (kind !== 'A') {
      const baseText = gitShow(base, oldPath ?? filePath, repoRoot);
      baseLines = baseText === null ? 0 : countLines(baseText);
    }
    files.push({ path: filePath, status: kind, baseLines, headLines });
  }
  return files;
}

function collectFromFixtures(fixturesPath) {
  const raw = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  return raw.map((f) => ({
    path: f.path,
    status: f.status,
    baseLines: f.baseLines ?? 0,
    headLines: f.headLines ?? 0,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repoRoot ?? path.join(HERE, '..', '..', '..'));

  let files;
  if (args.fixtures) {
    files = collectFromFixtures(args.fixtures);
  } else {
    if (!args.base || !args.head) {
      throw new Error('Need --base <sha> and --head <sha> (or --fixtures for local testing).');
    }
    files = collectFromGit(args.base, args.head, repoRoot);
  }

  let violations = 0;
  for (const file of files) {
    const message = checkFile(file);
    if (message) {
      violations += 1;
      console.log(`::error file=${escapeAnnotation(file.path)}::${escapeAnnotation(message)}`);
    }
  }

  if (violations > 0) {
    console.log(`file-size ratchet: ${violations} violation(s) — see annotations above.`);
  } else {
    console.log('file-size ratchet: clean.');
  }
  process.exitCode = violations > 0 ? 1 : 0;
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((err) => {
    console.error(`file-size ratchet failed: ${err.message}`);
    process.exitCode = 1;
  });
}
