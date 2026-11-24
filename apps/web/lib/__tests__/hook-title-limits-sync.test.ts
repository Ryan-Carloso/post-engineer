import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '@/test/repo-root';
import { HOOK_TITLE_MAX_CHARS, HOOK_TITLE_MAX_WORDS, HOOK_TITLE_SECONDS } from '../generation/hook-title';

const root = findRepoRoot(import.meta.url);

function linesMentioning(file: string, needle: string): string[] {
  const lines = readFileSync(join(root, file), 'utf8').split('\n').filter((line) => line.includes(needle));
  expect(lines.length, `${file} mentions ${needle}`).toBeGreaterThan(0);
  return lines;
}

describe('hook title limits stated in prose', () => {
  it('states the shared word and character limits in every contract description', () => {
    const lines = linesMentioning('shared/contracts/videos.ts', 'hookTitle: z.string()');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain(`at most ${HOOK_TITLE_MAX_WORDS} words`);
      expect(line).toContain(`${HOOK_TITLE_MAX_CHARS} characters`);
    }
  });

  it('states the shared on-screen seconds in the generate-and-schedule description', () => {
    const [line] = linesMentioning('shared/contracts/videos.ts', 'Optional on-screen headline shown at the top');
    expect(line).toContain(`first ${HOOK_TITLE_SECONDS} seconds`);
  });

  it('states the shared limits in the MCP README rows', () => {
    const [row] = linesMentioning('apps/mcp/README.md', '`options.hookTitle` adds an on-screen headline');
    expect(row).toContain(`at most ${HOOK_TITLE_MAX_WORDS} words and ${HOOK_TITLE_MAX_CHARS} characters`);
    expect(row).toContain(`first ${HOOK_TITLE_SECONDS} seconds`);
  });

  it('builds the MCP generate_video description from the constants, not from literals', () => {
    const source = readFileSync(join(root, 'apps/mcp/src/generate-video.ts'), 'utf8');
    expect(source).toContain('${HOOK_TITLE_MAX_WORDS} words and ${HOOK_TITLE_MAX_CHARS} characters');
    expect(source).toContain('first ${HOOK_TITLE_SECONDS} seconds');
  });
});
