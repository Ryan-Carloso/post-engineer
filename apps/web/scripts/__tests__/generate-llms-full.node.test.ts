import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLlmsFull, generateLlmsFull } from '@/scripts/generate-llms-full.mjs';
import { TOOL_DESCRIPTIONS } from '@/scripts/llms-full-content.mjs';
import { registeredToolActions, registeredToolNames } from '@/scripts/mcp-tool-inventory.mjs';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const publicFile = (name: string): string => readFileSync(join(root, 'apps/web/public', name), 'utf8');

const llms = publicFile('llms.txt');
const apiDocs = publicFile('api-documentation.txt');
const toolNames = registeredToolNames(root);
const toolActions = registeredToolActions(root);

describe('generate-llms-full', () => {
  it('matches the committed public/llms-full.txt (run node apps/web/scripts/generate-llms-full.mjs)', () => {
    expect(publicFile('llms-full.txt')).toBe(generateLlmsFull(root));
  });

  it('describes every registered tool exactly once, in a stable order', () => {
    const described = TOOL_DESCRIPTIONS.map(([tool]) => tool);
    expect([...described].sort()).toEqual(toolNames);
    expect(new Set(described).size).toBe(described.length);
  });

  it('refuses to build when a registered tool has no description', () => {
    expect(() =>
      buildLlmsFull({ llms, apiDocs, toolNames: [...toolNames, 'brand_new_tool'], toolActions }),
    ).toThrow(/brand_new_tool/);
  });

  it('refuses to build when a description names a tool the MCP server no longer registers', () => {
    expect(() =>
      buildLlmsFull({
        llms,
        apiDocs,
        toolNames: toolNames.filter((name) => name !== 'experiments'),
        toolActions,
      }),
    ).toThrow(/experiments/);
  });

  it('takes the action list of each tool from the MCP specs', () => {
    const output = buildLlmsFull({
      llms,
      apiDocs,
      toolNames,
      toolActions: { ...toolActions, experiments: ['results', 'summary', 'export'] },
    });

    expect(output).toContain('Actions: `results`, `summary`, `export`.');
  });

  it('counts the tools in the section intro from the registered tools', () => {
    expect(generateLlmsFull(root)).toContain(`${toolNames.length} intent tools;`);
  });

  it('copies api-documentation.txt verbatim, without its trailing blank lines', () => {
    const output = buildLlmsFull({ llms, apiDocs: `${apiDocs}\n\n`, toolNames, toolActions });

    expect(output).toContain(`=== BEGIN api-documentation.txt ===\n${apiDocs.trimEnd()}\n=== END`);
  });

  it('takes the prompts bullet from llms.txt instead of retyping it', () => {
    const changed = llms.replace('/daily-news', '/weekly-news');
    const output = buildLlmsFull({ llms: changed, apiDocs, toolNames, toolActions });

    expect(output).toContain('`/weekly-news`');
    expect(output).not.toContain('`/daily-news`');
  });

  it('rejects an llms.txt without the tool section or the prompts bullet', () => {
    const noSection = llms.slice(0, llms.indexOf('## MCP tools'));
    const noPrompts = llms.replace('- Prompts:', '- Other:');

    expect(() => buildLlmsFull({ llms: noSection, apiDocs, toolNames, toolActions })).toThrow(/MCP tools/);
    expect(() => buildLlmsFull({ llms: noPrompts, apiDocs, toolNames, toolActions })).toThrow(/Prompts/);
  });
});
