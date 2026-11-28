import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const WEB_VITEST_INCLUDE = '**/__tests__/**/*.test.{ts,tsx}';

const WEB_TEST_FILE = /\/__tests__\/.*\.test\.tsx?$/;

const MODULE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

const RUN_ALL_PREFIXES = [
  'apps/web/test/',
  '.github/scripts/frontend-ci/',
  '.github/workflows/',
  '.github/actions/',
  'supabase/',
  'apps/mcp/',
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

const ROOT_OUTPUT_DIRS = new Set(['coverage', 'coverage-unit']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);

export function isWebTestFile(relativePath) {
  return WEB_TEST_FILE.test(`/${relativePath}`);
}

export function shouldRunAll(changedPaths) {
  for (const file of changedPaths) {
    if (RUN_ALL_FILES.has(file)) return true;
    if (RUN_ALL_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
    if (file.startsWith('apps/web/cypress/')) continue;
    if ((file.startsWith('apps/web/') || file.startsWith('shared/')) && !MODULE_FILE.test(file)) return true;
  }
  return false;
}

export function isRelevantSource(file) {
  if (file.endsWith('.d.ts')) return false;
  if (!MODULE_FILE.test(file)) return false;
  return file.startsWith('apps/web/') || file.startsWith('shared/') || file.startsWith('scripts/');
}

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

export async function listAllTestFiles(appRoot) {
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
