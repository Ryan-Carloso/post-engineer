import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_PAGES, docLocales, docPath } from '@/lib/docs/registry';
import { registeredToolActions, registeredToolNames } from '@/scripts/mcp-tool-inventory.mjs';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);
const publicDir = join(repoRoot, 'apps', 'web', 'public');
const llms = readFileSync(join(publicDir, 'llms.txt'), 'utf8');
const llmsFull = readFileSync(join(publicDir, 'llms-full.txt'), 'utf8');
const apiDocs = readFileSync(join(publicDir, 'api-documentation.txt'), 'utf8');

const TOOLS_HEADING = '## MCP tools';
const PLATFORM_HEADING = '## Platform';

function between(text: string, from: string, to: string | null): string {
  const start = text.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = to === null ? text.length : text.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function toolBullets(): Map<string, string[]> {
  const section = between(llmsFull, TOOLS_HEADING, '\n## More');
  const tools = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const head = /^- `([a-z_]+)`/.exec(line);
    if (head === null) continue;
    const actionsAt = line.indexOf('Actions:');
    const actions =
      actionsAt === -1
        ? []
        : [...line.slice(actionsAt).matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    tools.set(head[1], actions);
  }
  return tools;
}

describe('llms-full.txt', () => {
  it('contains every link of llms.txt', () => {
    const urls = [...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(llmsFull).toContain(url);
    }
  });

  it('starts with the llms.txt title, intro and link lists, unchanged', () => {
    const head = between(llms, '# Post Engineer', `\n${TOOLS_HEADING}`);
    expect(head).toContain(PLATFORM_HEADING);
    expect(llmsFull.startsWith(head)).toBe(true);
  });

  it('embeds api-documentation.txt as one unbroken block', () => {
    const block = between(
      llmsFull,
      '=== BEGIN api-documentation.txt ===\n',
      '=== END api-documentation.txt ===',
    );
    expect(block).toBe(`=== BEGIN api-documentation.txt ===\n${apiDocs.trimEnd()}\n`);
  });

  it('lists exactly the tools the MCP server registers', () => {
    const documented = [...toolBullets().keys()].sort();
    expect(documented).toEqual(registeredToolNames(repoRoot));
  });

  it('states the registered tool count in the section intro', () => {
    expect(llmsFull).toContain(`${registeredToolNames(repoRoot).length} intent tools`);
  });

  it('lists exactly the actions each registered tool offers', () => {
    const documented = toolBullets();
    for (const [tool, actions] of Object.entries(registeredToolActions(repoRoot))) {
      expect([...(documented.get(tool) ?? [])].sort(), tool).toEqual([...actions].sort());
    }
  });

  it('keeps every action that llms.txt names for a tool, and every such tool is documented', () => {
    const section = collapse(between(llms, TOOLS_HEADING, null));
    const documented = toolBullets();
    const registered = registeredToolNames(repoRoot);
    let checked = 0;
    for (const match of section.matchAll(/`([a-z_]+)` \(([^)]*)\)/g)) {
      const tool = match[1];
      expect(registered, `llms.txt names ${tool} as a tool`).toContain(tool);
      expect(documented.has(tool), `llms-full.txt documents ${tool}`).toBe(true);
      const actions = [...match[2].matchAll(/`([a-z_]+)`/g)].map((token) => token[1]);
      for (const action of actions) {
        expect(documented.get(tool), `${tool}.${action}`).toContain(action);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('only names registered tools and real actions between backticks in the llms.txt tool section', () => {
    const section = between(llms, TOOLS_HEADING, null);
    const tokens = new Set([...section.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]));
    const tools = registeredToolNames(repoRoot);
    const actions = new Set(Object.values(registeredToolActions(repoRoot)).flat());
    for (const token of tokens) {
      expect(tools.includes(token) || actions.has(token) || token === 'action', token).toBe(true);
    }
    for (const tool of tools.filter((name) => tokens.has(name))) {
      expect(toolBullets().has(tool), `llms-full.txt documents ${tool}`).toBe(true);
    }
    expect(tokens.has('publish_video')).toBe(true);
    expect(tokens.has('publish_existing')).toBe(true);
  });

  it('links the OpenAPI spec, the MCP README and the prompt hub', () => {
    const more = between(llmsFull, '## More', null);
    expect(more).toContain('https://post-engineer.com/openapi.json');
    expect(more).toContain('https://github.com/Ryan-Carloso/post-engineer/tree/main/apps/mcp');
    expect(more).toContain('https://post-engineer.com/recipes');
  });

  it('links every docs and help page', () => {
    for (const page of DOC_PAGES) {
      for (const locale of docLocales(page)) {
        expect(llms).toContain(`https://post-engineer.com${docPath(page, locale)}`);
      }
    }
  });
});
