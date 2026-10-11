#!/usr/bin/env node
/**
 * File-size ratchet lint — CI entry point.
 *
 * Diff-based: only files CHANGED in the PR diff are linted. A file is
 * flagged when:
 *   - a NEW file exceeds LINE_CAP lines, or
 *   - a MODIFIED file grows past LINE_CAP lines (this is a true ratchet:
 *     files already above the cap are grandfathered and may only shrink —
 *     any growth past the cap fails, there is no warning-only loophole).
 *
 * Exempt: test files, supabase/migrations, lockfiles, markdown. Only
 * *.py / *.ts / *.tsx are checked; everything else is ignored.
 *
 * Usage:
 *   node check.mjs --base <sha> --head <sha> [--repo-root <path>]
 *   node check.mjs --fixtures <path>          # test hook: JSON list of
 *                                            # { path, status, baseLines, headLines }
 *
 * Exit code: 1 when any violation exists, else 0. Violations are printed
 * as GitHub ::error annotations (file=<path>).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The cap (lines) a source file may have before the ratchet bites.
// Shared from one constant so tests pin the same value as CI.
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

/** True for files this lint covers at all (*.py / *.ts / *.tsx). */
export function isSourceFile(p) {
  return /\.(py|tsx?)$/.test(p);
}

/** True for paths excluded from the lint (tests, migrations, lockfiles, docs). */
export function isExempt(p) {
  const segments = p.split('/');
  const base = segments[segments.length - 1];
  // Test files: *.test.*, *_test.*, or anything under a test(s) directory.
  if (base.includes('.test.') || base.includes('_test.')) return true;
  if (segments.some((s) => s === 'test' || s === 'tests')) return true;
  // Versioned DB migrations are append-only by design; never linted.
  if (segments[0] === 'supabase' && segments[1] === 'migrations') return true;
  // Lockfiles: pnpm-lock.yaml, uv.lock, and any *.lock.
  if (base === 'pnpm-lock.yaml' || base === 'uv.lock' || base.endsWith('.lock')) return true;
  // Markdown docs.
  if (base.endsWith('.md')) return true;
  return false;
}

/**
 * Count lines in text the way an editor shows them: every newline plus a
 * final unterminated line. Empty file counts 0.
 */
export function countLines(text) {
  if (text.length === 0) return 0;
  const newlines = (text.match(/\n/g) || []).length;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

/**
 * Evaluate one changed file. Returns a human-readable violation message,
 * or null when the file is compliant (or out of scope).
 */
export function checkFile({ path: p, status, baseLines, headLines }) {
  if (!isSourceFile(p) || isExempt(p)) return null;
  const kind = status[0]; // 'R100' -> 'R', etc.
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
  // Deleted / unmerged / unknown statuses are never violations.
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
    return null; // Missing at this ref (e.g. renamed across the diff).
  }
}

/**
 * Collect { path, status, baseLines, headLines } for every changed file in
 * `git diff base...head`, skipping files that can never violate.
 */
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
