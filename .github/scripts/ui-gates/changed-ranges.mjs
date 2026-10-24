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
//
// Path shapes: the file identity comes from the `---`/`+++` lines
// (unambiguous even for paths with spaces), NOT from the `diff --git`
// line (ambiguous for paths with spaces). `core.quotePath=false` keeps
// non-ASCII literal; quoted paths (git quotes paths with `"` when it
// must) are unquoted before use.
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
// unquoteGitPath — git quotes a path with `"` (C-style) when it
// contains special characters; core.quotePath=false already keeps
// non-ASCII literal, but quotes can still appear. Returns the literal
// path with surrounding quotes stripped (git's C unescaping is
// unnecessary for the characters that survive quotePath=false).
//---------------
export function unquoteGitPath(text) {
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
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
    if (info.deleted || info.binary || info.path === null) return;
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
      // Only a separator: file identity comes from ---/+++ below (the
      // header line is ambiguous for paths with spaces).
      flushFile();
      continue;
    }
    if (current === null) current = { path: null, deleted: false, binary: false, isNew: false, renamed: false, forceWholeFile: false };
    if (rawLine.startsWith('deleted file mode')) {
      current.deleted = true;
    } else if (rawLine.startsWith('new file mode')) {
      current.isNew = true;
    } else if (rawLine.startsWith('Binary files ')) {
      current.binary = true;
    } else if (rawLine.startsWith('rename from ') || rawLine.startsWith('rename to ')) {
      current.renamed = true;
    } else if (rawLine.startsWith('--- ')) {
      // Old path: sets the "this is a real file diff" marker; a
      // /dev/null old side means the file is new.
      if (rawLine === '--- /dev/null') current.isNew = true;
    } else if (rawLine.startsWith('+++ ')) {
      // The NEW path — the file's identity for mutation purposes.
      if (rawLine === '+++ /dev/null') {
        current.deleted = true;
      } else {
        current.path = unquoteGitPath(rawLine.slice('+++ '.length)).replace(/^b\//, '');
        if (addedHere === null) addedHere = [];
      }
    } else if (rawLine.startsWith('@@')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      if (!match) {
        // Unparseable hunk header: the file mutates WHOLE (fallback, not
        // skip — skipping would weaken the gate).
        current.forceWholeFile = true;
        continue;
      }
      newSideLine = parseInt(match[1], 10);
    } else if (rawLine.startsWith('+')) {
      if (addedHere !== null && newSideLine > 0) addedHere.push(newSideLine);
      newSideLine += 1;
    } else if (rawLine.startsWith('-')) {
      // Removed lines have no mutants in the new tree.
    } else if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file"
    } else if (rawLine.startsWith(' ')) {
      newSideLine += 1;
    }
  }
  flushFile();

  return [...files.values()].filter((entry) => !filterTestish || !isTestishPath(entry.path));
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
    '-c',
    'core.quotePath=false',
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

//---------------
// runGitFromRepoRoot — the CLI's git runs from the repo ROOT so the
// callers' working directory (e.g. apps/web in the ui-coverage-gates
// step) cannot change what the pathspecs match.
//---------------
export function runGitFromRepoRoot(args) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  return execFileSync('git', args, { encoding: 'utf8', cwd: root });
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

if (process.argv[1] && process.argv[1].endsWith('changed-ranges.mjs')) {
  const base = arg('--base');
  const head = arg('--head');
  if (!base || !head) {
    console.error('Usage: node changed-ranges.mjs --base <ref> --head <ref> [--app <dir> | --files <list> --strip-prefix <p>]');
    process.exit(2);
  }
  const app = arg('--app');
  const filesArg = arg('--files');
  const stripPrefix = app ? `apps/${app}/` : arg('--strip-prefix');
  const filesSet = filesArg
    ? new Set(
        filesArg
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0),
      )
    : null;
  const mergeGap = parseInt(arg('--merge-gap') ?? String(DEFAULT_MERGE_GAP), 10);
  const maxRanges = parseInt(arg('--max-ranges') ?? String(DEFAULT_MAX_RANGES), 10);
  const filter =
    app !== null
      ? (path) => path.startsWith(`apps/${app}/`)
      : filesSet
        ? (path) => filesSet.has(path)
        : null;
  console.log(
    runForScope({ base, head, filter, stripPrefix: stripPrefix ?? null, mergeGap, maxRanges }),
  );
}

function runForScope({ base, head, filter, stripPrefix, mergeGap, maxRanges }) {
  const diff = runGitFromRepoRoot([
    '-c',
    'core.quotePath=false',
    'diff',
    '-U0',
    '--diff-filter=ACMR',
    `${base}...${head}`,
    '--',
    '*.ts',
    '*.tsx',
    '*.js',
    '*.mjs',
    '*.jsx',
  ]);
  const entries = parseChangedRanges(diff, { mergeGap, maxRanges }).filter((entry) =>
    filter ? filter(entry.path) : true,
  );
  return mutateArgument(entries, { stripPrefix });
}
