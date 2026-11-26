// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../../test/repo-root';

const WEB_ROOT = join(findRepoRoot(import.meta.url), 'apps', 'web');
const DOCS_DIR = join(WEB_ROOT, 'lib', 'docs') + sep;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.next') continue;
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function stripTypeImports(source: string): string {
  return source.replace(/import\s+type\s+[^'"]*?from\s*['"][^'"]+['"]/g, '');
}

function importedSpecifiers(source: string): string[] {
  const stripped = stripTypeImports(source);
  const specifiers: string[] = [];
  for (const match of stripped.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1]);
  }
  for (const match of stripped.matchAll(/(?<!\w)import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(WEB_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importClosure(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current.file)) continue;
    seen.set(current.file, current.chain);
    const source = readFileSync(current.file, 'utf8');
    for (const specifier of importedSpecifiers(source)) {
      const resolved = resolveLocal(current.file, specifier);
      if (resolved !== null && !seen.has(resolved)) {
        queue.push({ file: resolved, chain: [...current.chain, resolved] });
      }
    }
  }
  return seen;
}

function clientEntries(): string[] {
  const roots = [join(WEB_ROOT, 'app'), join(WEB_ROOT, 'components'), join(WEB_ROOT, 'lib')];
  return roots
    .flatMap((root) => listSourceFiles(root))
    .filter((file) => readFileSync(file, 'utf8').trimStart().startsWith("'use client'"));
}

describe('client bundle — docs content model stays server-only', () => {
  it('no client component transitively imports lib/docs', () => {
    const offenders: string[] = [];
    for (const entry of clientEntries()) {
      const closure = importClosure(entry);
      for (const [file, chain] of closure) {
        if (file.startsWith(DOCS_DIR)) {
          offenders.push(`${entry} -> ${chain.slice(1).join(' -> ')}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('pricing-contact does not import lib/seo', () => {
    const source = readFileSync(join(WEB_ROOT, 'components', 'ui', 'pricing-contact.tsx'), 'utf8');
    expect(source.includes('@/lib/seo')).toBe(false);
  });
});
