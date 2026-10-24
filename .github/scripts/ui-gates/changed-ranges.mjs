#!/usr/bin/env node
//---------------
// changed-ranges.mjs — Stryker mutate patterns for the CHANGED lines of
// a PR (mutation.yml, the web/mcp `stryker` job and the
// ui-coverage-gates Stryker step).
//
// Parses `git diff -U0 <base>...<head>` and emits one mutate pattern per
// changed range, in Stryker's native line-range syntax
// (`path:startLine-endLine`, 1-based inclusive — see Stryker's
// MUTATION_RANGE_REGEX in @stryker-mutator/core fs/project-reader.js).
// A mutant is selected when its location INTERSECTS a range, so
// multi-line statements partially inside a range are still mutated.
//
// Conservative rules (never fewer mutants than the PR's changes):
// - a NEW file mutates whole (wholeFile — every line is added anyway);
// - deleted and binary files are excluded (nothing to mutate);
// - a renamed file with no content edits is excluded;
// - when a file's changed lines explode past maxRanges, the whole file
//   mutates (a sprawling diff likely touches everything);
// - the CLI exits non-zero on any parsing/usage error — the caller then
//   falls back to whole-file patterns (same escaping as before).
//
// Output (CLI): the space-separated --mutate argument (Stryker accepts
// several entries), '' when the PR changes nothing relevant. Bracketed
// Next.js paths get the [[]]/[]] minimatch escaping the workflows use.
//---------------

import { execFileSync } from 'node:child_process';

const DEFAULT_MERGE_GAP = 3;
const DEFAULT_MAX_RANGES = 50;

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1];
}

//---------------
// isTestishPath — the same exclusions the changed-files steps apply
// (single source now: the parser drops them so the diff and the file
// list can never disagree).
//---------------
export function isTestishPath(repoPath) {
  return (
    repoPath.includes('/__tests__/') ||
    repoPath.includes('/cypress/') ||
    /\.(test|cy)\.tsx?$/.test(repoPath) ||
    repoPath.endsWith('.d.ts')
  );
}

//---------------
// parseChangedRanges — the pure core, covered by changed-ranges.test.mjs.
//
// diffText: unified diff (-U0). Returns, per file (repo-relative):
// - { path, wholeFile: true, ranges: null } for a new file;
// - { path, wholeFile: false, ranges: [[start, end], ...] } merged ranges
//   of the ADDED/changed lines' new-side positions;
// - deleted and binary files and test-ish files are absent.
//---------------
export function parseChangedRanges(
  diffText,
  { mergeGap = DEFAULT_MERGE_GAP, maxRanges = DEFAULT_MAX_RANGES, filterTestish = true } = {},
) {
  const files = new Map();
  let current = null;
  let newSideLine = 0;
  let addedHere = null;

  const flushFile = () => {
    if (current === null) return;
    const info = current;
    const added = addedHere;
    current = null;
    addedHere = null;
    if (info.deleted || info.binary) return;
    if (info.renamed && (added === null || added.length === 0)) {
      // A pure rename with no content edits: nothing changed — exclude.
      return;
    }
    if (info.isNew || info.forceWholeFile || added === null || added.length === 0) {
      // No hunks (mode-only change), a brand-new file, or an unparseable
      // hunk: whole file — every change is inside it anyway, and the
      // fallback is never weaker.
      files.set(info.path, { path: info.path, wholeFile: true, ranges: null });
      return;
    }
    const merged = mergeLines(added, mergeGap);
    if (merged.length > maxRanges) {
      files.set(info.path, { path: info.path, wholeFile: true, ranges: null });
    } else {
      files.set(info.path, { path: info.path, wholeFile: false, ranges: merged });
    }
  };

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      flushFile();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(rawLine);
      if (!match) continue;
      current = {
        path: match[2],
        aPath: match[1],
        deleted: false,
        binary: false,
        isNew: false,
        renamed: false,
        forceWholeFile: false,
      };
      addedHere = [];
      continue;
    }
    if (current === null) continue;
    if (rawLine.startsWith('deleted file mode')) {
      current.deleted = true;
    } else if (rawLine.startsWith('new file mode')) {
      current.isNew = true;
    } else if (rawLine.startsWith('Binary files ')) {
      current.binary = true;
    } else if (rawLine.startsWith('rename from ') || rawLine.startsWith('rename to ')) {
      current.renamed = true;
    } else if (rawLine.startsWith('--- ')) {
      if (rawLine === '--- /dev/null') current.isNew = true;
    } else if (rawLine.startsWith('+++ ')) {
      if (rawLine === '+++ /dev/null') current.deleted = true;
    } else if (rawLine.startsWith('@@')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      if (!match) {
        // Unparseable hunk header: the file mutates WHOLE (fallback, not
        // skip — skipping would weaken the gate).
        current.forceWholeFile = true;
        continue;
      }
      newSideLine = parseInt(match[1], 10);
    } else if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      if (newSideLine > 0) addedHere.push(newSideLine);
      newSideLine += 1;
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      // Removed lines have no mutants in the new tree.
    } else if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file"
    } else {
      // Context line (empty at -U0 spacing included) — advances nothing:
      // with -U0 there are no context lines; a blank line here is the
      // diff's trailing newline or a mode-only gap.
      if (rawLine.startsWith(' ')) newSideLine += 1;
    }
  }
  flushFile();

  const out = [...files.values()].filter((entry) => !filterTestish || !isTestishPath(entry.path));
  return out;
}

function mergeLines(lines, mergeGap) {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const line of sorted.slice(1)) {
    if (line - end <= mergeGap + 1) {
      end = line;
    } else {
      ranges.push([start, end]);
      start = line;
      end = line;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

//---------------
// escapeBrackets — minimatch character-class escaping for bracketed
// Next.js paths (single pass; see the workflow comment on why a second
// pass would corrupt the escapes).
//---------------
export function escapeBrackets(path) {
  return path.replace(/(\[|\])/g, (_, ch) => (ch === '[' ? '[[]' : '[]]'));
}

//---------------
// mutateArgument — one space-separated --mutate string from the parsed
// ranges. Ranged entries and whole-file entries cannot be mixed in ONE
// pattern, so each range is its own entry; Stryker unions multiple
// ranged entries per file (fs/project-reader.js unionFileDescriptions).
//---------------
export function mutateArgument(entries, { stripPrefix = null } = {}) {
  const patterns = [];
  for (const entry of entries) {
    let path = entry.path;
    if (stripPrefix !== null) {
      if (!path.startsWith(stripPrefix)) continue;
      path = path.slice(stripPrefix.length);
    }
    path = escapeBrackets(path);
    if (entry.wholeFile) {
      patterns.push(path);
    } else {
      for (const [start, end] of entry.ranges) {
        patterns.push(`${path}:${start}-${end}`);
      }
    }
  }
  return patterns.join(' ');
}

//---------------
// changedMutateArgument — CLI core: git diff + filters → the mutate
// argument for one app's scope (ts/tsx, no tests/cypress). Throws on
// unusable diffs; the caller falls back to whole-file patterns.
//---------------
export function changedMutateArgument(baseRef, headRef, runGit = defaultRunGit, options = {}) {
  const diff = runGit([
    'diff',
    '-U0',
    '--diff-filter=ACMR',
    `${baseRef}...${headRef}`,
    '--',
    '*.ts',
    '*.tsx',
    '*.js',
    '*.mjs',
    '*.jsx',
  ]);
  const filter = options.appFilter ?? options.fileFilter ?? null;
  const entries = parseChangedRanges(diff, options).filter((entry) =>
    filter ? filter(entry.path) : true,
  );
  return mutateArgument(entries, { stripPrefix: options.stripPrefix ?? null });
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

//---------------
// CLI: --app web|mcp (app-relative mutate patterns, tests filtered) or
// --files a,b,c with --strip-prefix (repo-relative list from detect.mjs,
// parsed against the same diff).
//---------------
function main() {
  const base = arg('--base');
  const head = arg('--head');
  if (!base || !head) {
    console.error('Usage: node changed-ranges.mjs --base <ref> --head <ref> [--app <dir>] [--files <list> --strip-prefix <p>]');
    process.exit(2);
  }
  const filesArg = arg('--files');
  const stripPrefix = arg('--strip-prefix') ?? (arg('--app') ? `apps/${arg('--app')}/` : null);
  const app = arg('--app');
  const filesSet = filesArg
    ? new Set(
        filesArg
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0),
      )
    : null;
  const appFilter = app
    ? (path) => path.startsWith(`apps/${app}/`)
    : null;
  const fileFilter = filesSet ? (path) => filesSet.has(path) : null;
  const filter = appFilter ?? fileFilter;
  const mergeGap = parseInt(arg('--merge-gap') ?? String(DEFAULT_MERGE_GAP), 10);
  const maxRanges = parseInt(arg('--max-ranges') ?? String(DEFAULT_MAX_RANGES), 10);
  const result = changedMutateArgument(base, head, defaultRunGit, {
    appFilter: filter,
    fileFilter,
    stripPrefix,
    mergeGap,
    maxRanges,
  });
  console.log(result);
}

if (process.argv[1] && process.argv[1].endsWith('changed-ranges.mjs')) {
  main();
}
