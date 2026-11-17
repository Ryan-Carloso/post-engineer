//---------------
// select-tests — which vitest files a PR shard runs.
//
// Push to main (and any non-PR event) runs the whole suite. A pull request
// runs `vitest --changed` against the base commit, unless the diff touches
// something that module graph cannot see (the vitest config, setup files,
// the lockfile, a workflow, or a non-module file under apps/web or shared).
// An empty changed-list for a real source edit falls back to the full suite
// so a missed graph edge cannot skip the tests for that edit.
//---------------

import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Pinned to apps/web/vitest.config.ts `test.include` by select-tests.test.mjs.
export const WEB_VITEST_INCLUDE = '**/__tests__/**/*.test.{ts,tsx}';

const WEB_TEST_FILE = /\/__tests__\/.*\.test\.tsx?$/;

const MODULE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

const RUN_ALL_PREFIXES = [
  'apps/web/test/',
  '.github/scripts/frontend-ci/',
  '.github/workflows/',
  '.github/actions/',
  // Web tests read these from disk. vitest --changed only follows imports,
  // so a migration-only, engine-only, or MCP-only diff would otherwise
  // select nothing: the web app imports the MCP package through the
  // gitignored apps/mcp/dist, and sync tests read apps/mcp/src via
  // readFileSync. Recipe docs are pinned the same way by
  // prompt-status-claims.test.ts.
  'supabase/',
  'apps/engine/',
  'apps/mcp/',
  'docs/recipes/',
];

const RUN_ALL_FILES = new Set([
  'apps/web/vitest.config.ts',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/next.config.ts',
  'apps/web/eslint.config.mjs',
  'apps/web/.oxlintrc.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.base.json',
]);

// Top-level output directories only. `app/api/coverage` is a real route, and
// `cypress/support/__tests__` is part of the vitest include.
const ROOT_OUTPUT_DIRS = new Set(['coverage', 'coverage-unit']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);

/**
 * @param {string} relativePath path relative to apps/web, posix separators
 */
export function isWebTestFile(relativePath) {
  return WEB_TEST_FILE.test(`/${relativePath}`);
}

/**
 * @param {string[]} changedPaths repo-relative
 */
export function shouldRunAll(changedPaths) {
  for (const file of changedPaths) {
    if (RUN_ALL_FILES.has(file)) return true;
    if (RUN_ALL_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
    if (file.startsWith('apps/web/cypress/')) continue;
    // JSON, CSS, SQL, and other files tests read from disk are invisible to
    // vitest --changed, which only follows the import graph.
    if ((file.startsWith('apps/web/') || file.startsWith('shared/')) && !MODULE_FILE.test(file)) return true;
  }
  return false;
}

/**
 * @param {string} file repo-relative
 */
export function isRelevantSource(file) {
  if (file.endsWith('.d.ts')) return false;
  if (!MODULE_FILE.test(file)) return false;
  return file.startsWith('apps/web/') || file.startsWith('shared/') || file.startsWith('scripts/');
}

/**
 * @param {object} input
 * @param {string} input.event
 * @param {string[]} input.changedPaths
 * @param {boolean} input.forceAll
 * @param {string[]} input.allFiles
 * @param {string[]} input.listedChanged
 * @param {boolean} input.listChangedFailed
 * @returns {{ mode: 'all' | 'affected' | 'none', files: string[] }}
 */
export function selectTestFiles({
  event,
  changedPaths,
  forceAll,
  allFiles,
  listedChanged,
  listChangedFailed,
}) {
  if (event !== 'pull_request' || forceAll || shouldRunAll(changedPaths)) {
    return { mode: 'all', files: allFiles };
  }
  if (listChangedFailed) return { mode: 'all', files: allFiles };
  if (listedChanged.length === 0 && changedPaths.some(isRelevantSource)) {
    return { mode: 'all', files: allFiles };
  }
  if (listedChanged.length === 0) return { mode: 'none', files: [] };
  return { mode: 'affected', files: listedChanged };
}

/**
 * `git diff --name-status` output. A deletion under the web app or shared
 * prompts a full run: vitest --changed does not follow a removed import.
 * @param {string} text
 * @returns {{ changed: string[], forceAll: boolean }}
 */
export function parseNameStatus(text) {
  const changed = [];
  let forceAll = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0];
    for (const file of parts.slice(1)) {
      changed.push(file);
      if (status.startsWith('D') && (file.startsWith('apps/web/') || file.startsWith('shared/'))) {
        forceAll = true;
      }
    }
  }
  return { changed, forceAll };
}

/**
 * @param {string} appRoot absolute path of apps/web
 * @returns {Promise<string[]>} posix paths relative to appRoot
 */
export async function listAllTestFiles(appRoot) {
  /** @type {string[]} */
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(appRoot, full).split(path.sep).join('/');
      if (SKIP_DIRS.has(entry.name)) continue;
      if (ROOT_OUTPUT_DIRS.has(entry.name) && relative === entry.name) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (isWebTestFile(relative)) {
        files.push(relative);
      }
    }
  }
  await walk(appRoot);
  files.sort();
  return files;
}
