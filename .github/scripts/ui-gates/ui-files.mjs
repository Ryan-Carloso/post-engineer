import { isVendoredCalendarCN } from '../file-size/vendored-calendarcn.mjs';

const UI_PREFIXES = ['apps/web/app/', 'apps/web/components/'];

export function isUiFile(repoPath) {
  if (typeof repoPath !== 'string') return false;
  if (!repoPath.endsWith('.ts') && !repoPath.endsWith('.tsx')) return false;
  if (!UI_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return false;
  if (isVendoredCalendarCN(repoPath)) return false;
  if (repoPath.includes('/__tests__/')) return false;
  if (/\.test\.tsx?$/.test(repoPath)) return false;
  if (/\.cy\.tsx?$/.test(repoPath)) return false;
  return true;
}
