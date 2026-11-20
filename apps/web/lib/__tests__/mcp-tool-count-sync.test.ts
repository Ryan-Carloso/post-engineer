import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const registeredCount = Number(/expect\(tools\)\.toHaveLength\((\d+)\)/.exec(read('apps/mcp/src/__tests__/tools-list-stats.test.ts'))?.[1]);

describe('the MCP tool count is the same everywhere it is quoted', () => {
  it('reads a tool count from the MCP tools/list test', () => {
    expect(registeredCount).toBeGreaterThan(0);
  });

  it.each([
    ['apps/web/lib/mcp-install-prompt.ts', /\b(\d+) tools\b/g],
    ['apps/web/public/llms.txt', /^(\d+) intent tools/gm],
    ['AGENTS.md', /\((\d+), most with an `action`\)/g],
  ])('%s quotes the registered count', (path, pattern) => {
    const quoted = [...read(path).matchAll(pattern)].map((match) => Number(match[1]));
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.every((count) => count === registeredCount)).toBe(true);
  });
});
