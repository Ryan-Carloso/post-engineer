import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..', '..', 'app', 'api');

const ANONYMOUS_ROUTES = new Set([
  'coverage/route.ts',
  'google-oauth/callback/route.ts',
  'google-oauth/start/route.ts',
  'instagram-auth/callback/route.ts',
  'instagram-auth/start/route.ts',
  'linkedin-auth/callback/route.ts',
  'linkedin-auth/start/route.ts',
  'threads-auth/callback/route.ts',
  'threads-auth/start/route.ts',
  'facebook-auth/callback/route.ts',
  'facebook-auth/start/route.ts',
  'fanvue-auth/callback/route.ts',
  'fanvue-auth/start/route.ts',
  'pinterest-auth/callback/route.ts',
  'pinterest-auth/start/route.ts',
  'version/route.ts',
]);

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out.sort();
}

function extractWrapperCalls(content: string): string[] {
  const calls: string[] = [];
  const marker = 'withApiErrorReporting(';
  let from = 0;
  while (true) {
    const start = content.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < content.length; i++) {
      if (content[i] === '(') depth++;
      else if (content[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(content.slice(start, i + 1));
    from = i + 1;
  }
  return calls;
}

describe('api user-identity coverage', () => {
  it('every authenticated route passes getUserId to withApiErrorReporting', () => {
    const missing: string[] = [];
    for (const file of collectRouteFiles(apiDir)) {
      const rel = relative(apiDir, file);
      if (ANONYMOUS_ROUTES.has(rel)) continue;
      const content = readFileSync(file, 'utf8');
      const calls = extractWrapperCalls(content);
      for (const call of calls) {
        if (!call.includes('getUserId')) missing.push(`${rel}: ${call.slice(0, 80)}...`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('anonymous routes do not pass getUserId (no user session to attribute)', () => {
    const offending: string[] = [];
    for (const rel of ANONYMOUS_ROUTES) {
      const content = readFileSync(join(apiDir, rel), 'utf8');
      for (const call of extractWrapperCalls(content)) {
        if (call.includes('getUserId')) offending.push(rel);
      }
    }
    expect(offending).toEqual([]);
  });

  it('the anonymous allowlist only names route files that exist', () => {
    const files = new Set(collectRouteFiles(apiDir).map((f) => relative(apiDir, f)));
    for (const rel of ANONYMOUS_ROUTES) {
      expect(files.has(rel), `${rel} is in ANONYMOUS_ROUTES but the file is gone`).toBe(true);
    }
  });
});
