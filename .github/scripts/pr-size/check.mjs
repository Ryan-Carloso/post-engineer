#!/usr/bin/env node
/**
 * PR size limit check — CI entry point.
 *
 * Counts added lines of production code in a PR diff (merge-base with
 * main .. head) and fails when the total exceeds PR_SIZE_LIMIT.
 * Deletions never count. Only .ts, .tsx, .py, .js, .mjs, .cjs, .sql
 * count; test files, docs, lockfiles, and generated/snapshot files are
 * excluded entirely. A maintainer-applied `size-limit-exempt` label
 * (passed via --labels JSON or the PR_LABELS env var) short-circuits
 * the limit without changing what is counted.
 *
 * Usage:
 *   node check.mjs --base <sha> --head <sha> [--limit 800]
 *   [--labels '<JSON array of {name} objects>']
 *
 * Exit code: 1 when the counted total exceeds the limit, else 0.
 * Counted files and the total are printed, with a GitHub ::error
 * annotation on failure.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The cap (added production lines) a PR may have before the check fails.
// Shared from one constant so tests pin the same value as CI.
export const PR_SIZE_LIMIT = 800;

export const SIZE_LIMIT_EXEMPT_LABEL = 'size-limit-exempt';

const COUNTED_EXTENSIONS = ['ts', 'tsx', 'py', 'js', 'mjs', 'cjs', 'sql'];

/** True for paths excluded from the count (tests, docs, lockfiles, snapshots). */
export function isExcludedFile(p) {
  const segments = p.split('/');
  const base = segments[segments.length - 1];
  // Docs: *.md, docs/**, README files.
  if (p.endsWith('.md')) return true;
  if (segments.includes('docs')) return true;
  if (/^README(\.|$)/.test(base)) return true;
  // Lockfiles.
  if (base === 'package-lock.json' || base === 'pnpm-lock.yaml' || base === 'yarn.lock' || base.endsWith('.lock')) return true;
  // Generated/snapshot files.
  if (segments.includes('__snapshots__') || p.endsWith('.snap')) return true;
  // Test files: test dirs, *.test.*, *.spec.*, test_*.py, *_test.py.
  if (segments.some((s) => s === '__tests__' || s === 'test' || s === 'tests')) return true;
  if (base.includes('.test.') || base.includes('.spec.')) return true;
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true;
  return false;
}

/** True for production code files this check counts. */
export function isCountedFile(p) {
  if (isExcludedFile(p)) return false;
  const ext = p.split('.').pop();
  return COUNTED_EXTENSIONS.includes(ext);
}

/**
 * Count added production lines from `git diff --numstat` output.
 * Returns { files: [{ added, path }], total }. Binary rows ("-") and
 * non-counted files contribute nothing; a pure rename (0 added) counts 0.
 */
export function countAddedLines(numstatText) {
  const files = [];
  let total = 0;
  for (const line of numstatText.split('\n')) {
    if (!line) continue;
    const firstTab = line.indexOf('\t');
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;
    const addedRaw = line.slice(0, firstTab);
    const path = line.slice(secondTab + 1);
    if (addedRaw === '-') continue;
    const added = Number(addedRaw);
    if (!Number.isFinite(added)) continue;
    if (!isCountedFile(path)) continue;
    files.push({ added, path });
    total += added;
  }
  return { files, total };
}

/** True when the counted total exceeds the limit. */
export function exceedsLimit(total, limit = PR_SIZE_LIMIT) {
  return total > limit;
}

/** True when the PR labels JSON contains the maintainer exemption label. */
export function hasExemptLabel(labelsJson) {
  if (!labelsJson) return false;
  try {
    const labels = JSON.parse(labelsJson);
    return Array.isArray(labels) && labels.some((l) => l && l.name === SIZE_LIMIT_EXEMPT_LABEL);
  } catch {
    return false;
  }
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base;
  const head = args.head || 'HEAD';
  const limit = args.limit ? Number(args.limit) : PR_SIZE_LIMIT;
  if (!base) {
    console.error('Usage: node check.mjs --base <sha> --head <sha> [--limit 800] [--labels <json>]');
    process.exit(2);
  }
  const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
  const numstat = execFileSync('git', ['diff', '--numstat', mergeBase, head], { encoding: 'utf8' });
  const { files, total } = countAddedLines(numstat);
  for (const f of files) console.log(`${f.added} ${f.path}`);
  console.log(`Total added production lines (tests/docs/deletions excluded): ${total}`);
  const labelsJson = args.labels || process.env.PR_LABELS || '';
  if (hasExemptLabel(labelsJson)) {
    console.log(`PR carries the ${SIZE_LIMIT_EXEMPT_LABEL} label: limit not enforced on this PR.`);
    return;
  }
  if (exceedsLimit(total, limit)) {
    console.log(
      `::error::PR adds ${total} production lines, over the ${limit}-line limit (deletions, tests, and docs excluded). Split the PR by complete layer, or justify it in the PR body, or ask a maintainer for the ${SIZE_LIMIT_EXEMPT_LABEL} label.`,
    );
    process.exit(1);
  }
  console.log(`PR size within the ${limit}-line limit.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
