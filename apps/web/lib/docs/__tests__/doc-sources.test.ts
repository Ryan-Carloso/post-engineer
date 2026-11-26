// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildInstallPrompt } from '@/lib/mcp-install-prompt';
import { TOOL_DESCRIPTIONS } from '@/scripts/llms-full-content.mjs';
import { registeredToolActions, registeredToolNames } from '@/scripts/mcp-tool-inventory.mjs';
import { findRepoRoot } from '@/test/repo-root';
import { DOC_PAGES } from '../registry';
import { localize, type DocBlock, type LocalizedText } from '../types';

function collectProse(blocks: DocBlock[]): string {
  const parts: string[] = [];
  const push = (text: LocalizedText) => {
    if (text.en !== undefined) parts.push(text.en);
    if (text.pt !== undefined) parts.push(text.pt);
  };
  for (const block of blocks) {
    if (block.kind === 'heading' || block.kind === 'paragraph') push(block.text);
    if (block.kind === 'list') block.items.forEach(push);
    if (block.kind === 'link') push(block.text);
  }
  return parts.join('\n');
}

const PROSE = DOC_PAGES.map((page) => collectProse(page.blocks)).join('\n');

describe('lib/docs — docs facts are imported, never retyped', () => {
  it('keeps every backticked snake_case identifier a registered tool or action', () => {
    const tokens = new Set([...PROSE.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]));
    expect(tokens.size).toBeGreaterThan(0);
    const known = new Set([
      ...registeredToolNames(findRepoRoot(import.meta.url)),
      ...Object.values(registeredToolActions(findRepoRoot(import.meta.url))).flat(),
    ]);
    for (const token of tokens) {
      expect(known.has(token)).toBe(true);
    }
  });

  it('renders the tool list from TOOL_DESCRIPTIONS, equal to the registered tools', () => {
    expect(DOC_PAGES.some((page) => page.blocks.some((block) => block.kind === 'toolList'))).toBe(true);
    const names = TOOL_DESCRIPTIONS.map(([name]) => name);
    expect([...names].sort()).toEqual([...registeredToolNames(findRepoRoot(import.meta.url))].sort());
  });

  it('never links to /recipes/<slug>', () => {
    for (const page of DOC_PAGES) {
      for (const block of page.blocks) {
        if (block.kind === 'link') {
          expect(localize(block.href, 'pt')).not.toMatch(/^\/recipes\//);
          expect(localize(block.href, 'en')).not.toMatch(/^\/recipes\//);
        }
      }
    }
  });

  it('never embeds a slash-command token in prose', () => {
    expect(PROSE).not.toMatch(/\/[a-z]+-[a-z]+/);
  });

  it('embeds the install prompt only in its code block, never in prose', () => {
    const prompt = buildInstallPrompt('en', null);
    const codeBlocks = DOC_PAGES.flatMap((page) =>
      page.blocks.filter((block) => block.kind === 'code'),
    );
    expect(codeBlocks.some((block) => block.code === prompt)).toBe(true);
    for (const line of prompt.split('\n')) {
      if (line.length >= 20) expect(PROSE).not.toContain(line);
    }
  });
});
