import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from './repo-root';

const ROUTE_FILES: ReadonlySet<string> = new Set(['page.tsx', 'route.ts']);

function hasRouteFile(dir: string): boolean {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith('_') || entry.startsWith('@')) continue;
      if (hasRouteFile(full)) return true;
    } else if (ROUTE_FILES.has(entry)) {
      return true;
    }
  }
  return false;
}

function isGroupDir(name: string): boolean {
  return name.startsWith('(') && name.endsWith(')');
}

function topLevelSegments(dir: string): string[] {
  const segments: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith('_') || entry.startsWith('@')) continue;
    if (isGroupDir(entry)) {
      segments.push(...topLevelSegments(full));
      continue;
    }
    if (entry.startsWith('[')) {
      throw new Error(`top-level dynamic segment ${entry} under ${dir} matches every path`);
    }
    if (hasRouteFile(full)) segments.push(`/${entry}`);
  }
  return segments;
}
export function appRouteSegments(fromUrl: string, group: string): string[] {
  const dir = join(findRepoRoot(fromUrl), 'apps', 'web', 'app', group);
  return topLevelSegments(dir).sort();
}
export function groupServesRoot(fromUrl: string, group: string): boolean {
  const dir = join(findRepoRoot(fromUrl), 'apps', 'web', 'app', group);
  return readdirSync(dir).includes('page.tsx');
}
