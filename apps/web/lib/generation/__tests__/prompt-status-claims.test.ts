/**
 * @vitest-environment node
 */

// Prompt status claims and tool-name guard: a served prompt must never
// state that a provider is broken, being fixed, or blocked by a tracked
// issue, and must never name a tool the MCP does not register. A stale
// status claim makes the agent skip that provider by default, and it goes
// stale the moment the fix lands: the prompt keeps saying "broken" long
// after publishing works again (Bluesky, issue #327, fixed by PR #332, is
// the case that motivated this guard). Provider availability is per
// account, never a blanket claim in prompt text. The same rule covers the
// full-setup recipe doc, which used to hand-repeat the prompt steps and
// the Bluesky warning instead of pointing at the hub.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import * as promptBase from '../prompt-base';

const STALE_STATUS_PHRASES = ['currently being fixed', 'being fixed', 'issue #'];

// snake_case values in prompt text that are not tool calls: check_media
// returns face_detected as a photo-check code, it is never called as a
// tool, so it is excluded from the registration check by name, with the
// reason recorded here instead of silently passing an unknown token.
const NON_TOOL_TOKENS = new Set(['face_detected']);

function servedPromptTexts(): Array<{ name: string; text: string }> {
  const texts: Array<{ name: string; text: string }> = [];
  for (const [name, value] of Object.entries(promptBase)) {
    if (typeof value === 'string') {
      texts.push({ name, text: value });
    }
  }
  texts.push({ name: 'SHARED_PROMPT_BASE', text: promptBase.SHARED_PROMPT_BASE.join('\n') });
  return texts;
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') {
        out.push(...collectSourceFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function registeredToolNames(): Set<string> {
  const root = findRepoRoot(import.meta.url);
  const srcDir = join(root, 'apps', 'mcp', 'src');
  expect(existsSync(srcDir)).toBe(true);
  const names = new Set<string>();
  // Registrations span lines: server.tool(\n    'name', — \s matches the
  // newline between the paren and the quoted name.
  for (const file of collectSourceFiles(srcDir)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return names;
}

function mentionedToolNames(): string[] {
  const mentioned = new Set<string>();
  for (const { text } of servedPromptTexts()) {
    for (const match of text.matchAll(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g)) {
      const token = match[0];
      if (!NON_TOOL_TOKENS.has(token)) {
        mentioned.add(token);
      }
    }
  }
  return [...mentioned].sort();
}

describe('prompt status claims', () => {
  it('serves at least one prompt', () => {
    expect(servedPromptTexts().length).toBeGreaterThan(0);
  });

  it.each(servedPromptTexts())(
    '$name states no stale provider status or tracked issue',
    ({ text }) => {
      for (const phrase of STALE_STATUS_PHRASES) {
        expect(text).not.toContain(phrase);
      }
    },
  );

  it('keeps Bluesky as an ordinary optional provider in full-setup', () => {
    expect(promptBase.FULL_SETUP_PROMPT).toContain('Bluesky is optional');
    expect(promptBase.FULL_SETUP_PROMPT).not.toContain('Bluesky video publishing');
  });

  it('keeps the full-setup recipe doc a pointer to the hub, not a hand copy', () => {
    const root = findRepoRoot(import.meta.url);
    const doc = readFileSync(join(root, 'docs', 'recipes', 'full-setup.md'), 'utf8');
    expect(doc).toContain('https://post-engineer.com/recipes/full-setup');
    expect(doc).toContain('Bluesky (optional)');
    expect(doc).not.toContain('## Steps');
    for (const phrase of STALE_STATUS_PHRASES) {
      expect(doc).not.toContain(phrase);
    }
    expect(doc).not.toContain('Bluesky limitation');
  });
});

describe('prompt tool names match registered MCP tools', () => {
  it('finds registered tools and mentioned tool names', () => {
    const registered = registeredToolNames();
    expect(registered.size).toBeGreaterThan(0);
    expect(registered.has('generate_persona_video')).toBe(true);
    expect(mentionedToolNames().length).toBeGreaterThan(0);
  });

  it('registers every tool name mentioned in the served prompts', () => {
    const registered = registeredToolNames();
    const missing = mentionedToolNames().filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });
});

describe('every hub prompt comes from shared, never a hand copy', () => {
  it('serves each shared prompt in the hub, byte-identical', async () => {
    const { PROMPTS } = await import('@/app/recipes/prompts');
    const sharedTexts = new Set(
      Object.values(promptBase).filter((value): value is string => typeof value === 'string'),
    );
    expect(PROMPTS.length).toBeGreaterThan(0);
    for (const entry of PROMPTS) {
      expect(sharedTexts.has(entry.prompt)).toBe(true);
    }
    for (const text of sharedTexts) {
      expect(PROMPTS.some((entry) => entry.prompt === text)).toBe(true);
    }
  });
});
