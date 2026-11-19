import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assignShards, WEB_SHARD_TOTAL } from './shard-tests.mjs';
import {
  listAllTestFiles,
  parseNameStatus,
  selectTestFiles,
  shouldRunAll,
} from './select-tests.mjs';

export { WEB_SHARD_TOTAL };

/**
 * @param {object} input
 * @param {string} input.event
 * @param {string[]} input.changedPaths
 * @param {boolean} input.forceAll
 * @param {string[]} input.allFiles
 * @param {string[]} input.listedChanged
 * @param {boolean} input.listChangedFailed
 * @param {unknown} input.timings
 * @param {number} input.shard 1-based
 * @param {number} input.total
 */
export function planShard({
  event,
  changedPaths,
  forceAll,
  allFiles,
  listedChanged,
  listChangedFailed,
  timings,
  shard,
  total,
}) {
  const selection = selectTestFiles({
    event,
    changedPaths,
    forceAll,
    allFiles,
    listedChanged,
    listChangedFailed,
  });
  const bins = assignShards(selection.files, timings, total);
  if (!Number.isInteger(shard) || shard < 1 || shard > bins.length) {
    throw new Error(`shard ${shard} is outside 1..${total}`);
  }
  return { mode: selection.mode, files: bins[shard - 1] };
}

/**
 * Keep lines that look like test files and make them relative to apps/web.
 * @param {string} stdout
 * @param {string} appRoot
 */
export function parseVitestList(stdout, appRoot) {
  const root = path.resolve(appRoot);
  /** @type {Set<string>} */
  const files = new Set();
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!/\.test\.tsx?$/.test(line)) continue;
    const absolute = path.isAbsolute(line) ? line : path.resolve(root, line);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative.startsWith('..') || relative.length === 0) continue;
    files.add(relative);
  }
  return [...files].sort();
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function requireArg(name) {
  const value = arg(name);
  if (value === null || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function main() {
  const repoRoot = path.resolve(requireArg('--repo-root'));
  const appRel = requireArg('--app');
  const appRoot = path.resolve(repoRoot, appRel);
  const event = requireArg('--event');
  const base = arg('--base');
  const shard = Number(requireArg('--shard'));
  const total = Number(requireArg('--total'));
  const timingsPath = arg('--timings');

  let timings = {};
  if (timingsPath !== null && existsSync(timingsPath)) {
    try {
      timings = JSON.parse(readFileSync(timingsPath, 'utf8'));
    } catch (error) {
      process.stderr.write(
        `frontend-ci: ignoring unreadable timings (${error instanceof Error ? error.message : String(error)})\n`,
      );
    }
  }

  let changedPaths = [];
  let forceAll = false;
  let listedChanged = [];
  let listChangedFailed = false;

  if (event === 'pull_request') {
    if (base === null || base.length === 0) {
      forceAll = true;
      process.stderr.write('frontend-ci: no base sha; running the full suite\n');
    } else {
      try {
        const status = execFileSync(
          'git',
          ['diff', '--name-status', '--diff-filter=ACMRD', base, 'HEAD'],
          { cwd: repoRoot, encoding: 'utf8' },
        );
        const parsed = parseNameStatus(status);
        changedPaths = parsed.changed;
        forceAll = parsed.forceAll;
      } catch (error) {
        forceAll = true;
        process.stderr.write(
          `frontend-ci: git diff failed (${error instanceof Error ? error.message : String(error)}); running the full suite\n`,
        );
      }
    }
    if (!forceAll && !shouldRunAll(changedPaths)) {
      try {
        const stdout = execFileSync(
          'pnpm',
          ['exec', 'vitest', 'list', '--filesOnly', '--no-color', '--changed', base],
          { cwd: appRoot, encoding: 'utf8' },
        );
        listedChanged = parseVitestList(stdout, appRoot);
      } catch (error) {
        listChangedFailed = true;
        process.stderr.write(
          `frontend-ci: vitest --changed failed (${error instanceof Error ? error.message : String(error)}); running the full suite\n`,
        );
      }
    }
  }

  return listAllTestFiles(appRoot).then((allFiles) => {
    const plan = planShard({
      event,
      changedPaths,
      forceAll,
      allFiles,
      listedChanged,
      listChangedFailed,
      timings,
      shard,
      total,
    });
    process.stderr.write(
      `frontend-ci: mode=${plan.mode} shard=${shard}/${total} files=${plan.files.length}\n`,
    );
    if (plan.files.length > 0) process.stdout.write(`${plan.files.join('\n')}\n`);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
