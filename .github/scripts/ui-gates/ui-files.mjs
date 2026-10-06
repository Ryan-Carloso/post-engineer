//---------------
// UI file detection (paths relative to the repo root).
//
// A UI file is a TS/TSX source file under apps/web/app/** or
// apps/web/components/**, excluding test files (*.test.*, *.cy.* and
// __tests__/ directories). Changed files come from
// `git diff --name-only --diff-filter=ACMR <base>...<head>`.
//---------------

const UI_PREFIXES = ['apps/web/app/', 'apps/web/components/'];

export function isUiFile(repoPath) {
  if (typeof repoPath !== 'string') return false;
  if (!repoPath.endsWith('.ts') && !repoPath.endsWith('.tsx')) return false;
  if (!UI_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return false;
  if (repoPath.includes('/__tests__/')) return false;
  if (/\.test\.tsx?$/.test(repoPath)) return false;
  if (/\.cy\.tsx?$/.test(repoPath)) return false;
  return true;
}
