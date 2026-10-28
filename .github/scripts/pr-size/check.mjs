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
 * Undo git's C-quoting of a numstat path (default core.quotePath=true
 * quotes non-ASCII/control bytes, e.g. "apps/web/lib/caf\303\251.ts").
 * Without this, the quoted path's extension reads as `ts"` and the file
 * silently contributes 0 lines. The CLI also disables quoting, so this
 * is defense in depth for numstat text fed in from elsewhere.
 */
export function unquotePath(p) {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p;
  const inner = p.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next >= '0' && next <= '7' && i + 3 < inner.length + 1 && inner[i + 2] >= '0' && inner[i + 2] <= '7' && inner[i + 3] >= '0' && inner[i + 3] <= '7') {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
        i += 3;
        continue;
      }
      if (next === '"' || next === '\\') {
        bytes.push(next.charCodeAt(0));
        i += 1;
        continue;
      }
    }
    const code = c.charCodeAt(0);
    if (code < 128) bytes.push(code);
    else {
      // Non-ASCII char already decoded: re-encode as UTF-8 bytes.
      const encoded = new TextEncoder().encode(c);
      for (const b of encoded) bytes.push(b);
    }
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

/**
 * Resolve a numstat rename to the path as it exists at head. Git prints
 * renames in abbreviated notation, e.g. `dir/{old => new}.ts` or
 * `old => new`; classifying the raw string would misread its extension
 * (e.g. `ts}`) and miss test-dir renames, silently dropping added lines.
 */
export function renameNewPath(p) {
  const at = p.indexOf(' => ');
  if (at === -1) return p;
  const left = p.slice(0, at);
  const right = p.slice(at + 4);
  const open = left.lastIndexOf('{');
  const close = right.indexOf('}');
  const prefix = open === -1 ? '' : left.slice(0, open);
  const suffix = close === -1 ? '' : right.slice(close + 1);
  const name = open === -1 ? right : right.slice(0, close);
  return `${prefix}${name}${suffix}`;
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
    const path = renameNewPath(unquotePath(line.slice(secondTab + 1)));
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

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = argv[++i];
      }
    }
  }
  return args;
}

/**
 * Resolve the --limit value: undefined/true (value-less flag) means the
 * default, a numeric string means that number, anything else throws —
 * a malformed limit must error, never silently disable the cap via NaN.
 */
export function resolveLimit(limitRaw) {
  if (limitRaw === undefined || limitRaw === true) return PR_SIZE_LIMIT;
  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('--limit must be a positive number');
  }
  return limit;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base;
  const head = args.head || 'HEAD';
  let limit;
  try {
    limit = resolveLimit(args.limit);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (!base) {
    console.error('Usage: node check.mjs --base <sha> --head <sha> [--limit 800] [--labels <json>]');
    process.exit(2);
  }
  const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
  // Disable path quoting so non-ASCII paths arrive as raw UTF-8 and are
  // counted; countAddedLines also unquotes as defense in depth.
  const numstat = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--numstat', mergeBase, head], { encoding: 'utf8' });
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
