import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
    ['AGENTS.md', /\((\d+), each with an `action`\)/g],
  ])('%s quotes the registered count', (path, pattern) => {
    const quoted = [...read(path).matchAll(pattern)].map((match) => Number(match[1]));
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.every((count) => count === registeredCount)).toBe(true);
  });

  it('names every registered MCP tool in llms.txt', () => {
    const sourceDir = 'apps/mcp/src';
    const registered = readdirSync(join(root, sourceDir))
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) => [...read(`${sourceDir}/${file}`).matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map((match) => match[1]));
    const llms = read('apps/web/public/llms.txt');
    expect(registered.length).toBe(registeredCount);
    expect(registered.filter((name) => !llms.includes(`\`${name}\``))).toEqual([]);
  });

  it('introduces each tool with its actions only once in llms.txt', () => {
    const toolsSection = read('apps/web/public/llms.txt').split('## MCP tools')[1] ?? '';
    const introduced = [...toolsSection.matchAll(/`([a-z_]+)` \(/g)].map((match) => match[1]);
    expect(introduced.length).toBeGreaterThan(0);
    expect(new Set(introduced).size).toBe(introduced.length);
  });
});
