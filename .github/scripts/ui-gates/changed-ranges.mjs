#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { isVendoredCalendarCN } from '../file-size/vendored-calendarcn.mjs';
import { isVendoredUiDiff } from '../file-size/vendored-uidiff.mjs';
import { filterCodeChanged } from './code-changed.mjs';

const DEFAULT_MERGE_GAP = 3;
const DEFAULT_MAX_RANGES = 50;

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1];
}

export function isTestishPath(repoPath) {
  return (
    repoPath.includes('/__tests__/') ||
    repoPath.includes('/cypress/') ||
    /\.(test|cy)\.tsx?$/.test(repoPath) ||
    repoPath.endsWith('.d.ts') ||
    /\.gen\.tsx?$/.test(repoPath)
  );
}

export function unquoteGitPath(text) {
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

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
      return;
    }
    if (info.isNew || info.forceWholeFile || added === null || added.length === 0) {
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
      if (rawLine === '--- /dev/null') current.isNew = true;
    } else if (rawLine.startsWith('+++ ')) {
      if (rawLine === '+++ /dev/null') {
        current.deleted = true;
      } else {
        current.path = unquoteGitPath(rawLine.slice('+++ '.length)).replace(/^b\//, '');
        if (addedHere === null) addedHere = [];
      }
    } else if (rawLine.startsWith('@@')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      if (!match) {
        current.forceWholeFile = true;
        continue;
      }
      newSideLine = parseInt(match[1], 10);
    } else if (rawLine.startsWith('+')) {
      if (addedHere !== null && newSideLine > 0) addedHere.push(newSideLine);
      newSideLine += 1;
    } else if (rawLine.startsWith('-')) {
    } else if (rawLine.startsWith('\\')) {
    } else if (rawLine.startsWith(' ')) {
      newSideLine += 1;
    }
  }
  flushFile();

  return [...files.values()].filter(
    (entry) => (!filterTestish || !isTestishPath(entry.path)) && !isVendoredCalendarCN(entry.path) && !isVendoredUiDiff(entry.path),
  );
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

export function escapeBrackets(path) {
  return path.replace(/(\[|\])/g, (_, ch) => (ch === '[' ? '[[]' : '[]]'));
}

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

export function runGitFromRepoRoot(args) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  return execFileSync('git', args, { encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
    await runForScope({ base, head, filter, stripPrefix: stripPrefix ?? null, mergeGap, maxRanges }),
  );
}

async function runForScope({ base, head, filter, stripPrefix, mergeGap, maxRanges }) {
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
  const codeChanged = new Set(
    await filterCodeChanged(
      entries.map((entry) => entry.path),
      base,
      head,
      { runGit: runGitFromRepoRoot },
    ),
  );
  return mutateArgument(
    entries.filter((entry) => codeChanged.has(entry.path)),
    { stripPrefix },
  );
}
