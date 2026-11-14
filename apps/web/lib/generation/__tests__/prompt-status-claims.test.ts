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
import ts from 'typescript';
import { findRepoRoot } from '@/test/repo-root';
import * as promptBase from '../prompt-base';

const STALE_STATUS_PHRASES = ['currently being fixed', 'being fixed', 'issue #', 'is broken'];

// snake_case values in prompt text that are not tool calls:
// retention_evidence is an output field the viral-shorts prompt asks the
// agent to print ('unavailable' for another creator's video), not a tool.
// full_lipsync / hook_lipsync are video_type enum values and very_good is
// a face-quality value from the video-type cost line (issue #542
// follow-up), never tools.
const NON_TOOL_TOKENS = new Set(['retention_evidence', 'full_lipsync', 'hook_lipsync', 'very_good']);

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

//---------------
// The MCP's tools and their actions, read from its sources as syntax trees:
// every `server.tool('name', …)` registration, and for an action tool the
// keys of the `byAction({ key: handler, … })` object literal in its callback.
// A prompt may name a tool, or `tool (action: x)` with an action that tool
// really has; the MCP sources are the one source of truth (issue #566).
//---------------
function registeredTools(): Map<string, Set<string>> {
  const root = findRepoRoot(import.meta.url);
  const srcDir = join(root, 'apps', 'mcp', 'src');
  expect(existsSync(srcDir)).toBe(true);
  const tools = new Map<string, Set<string>>();
  for (const file of collectSourceFiles(srcDir)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'tool' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'server'
      ) {
        const [first] = node.arguments;
        const callback = node.arguments[node.arguments.length - 1];
        if (first !== undefined && ts.isStringLiteralLike(first)) {
          const actions = new Set<string>();
          if (
            callback !== undefined &&
            ts.isCallExpression(callback) &&
            ts.isIdentifier(callback.expression) &&
            callback.expression.text === 'byAction' &&
            callback.arguments[0] !== undefined &&
            ts.isObjectLiteralExpression(callback.arguments[0])
          ) {
            for (const property of callback.arguments[0].properties) {
              if (property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
                actions.add(property.name.text);
              }
            }
          }
          tools.set(first.text, actions);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return tools;
}

const ACTION_PAIR = /([a-z][a-z0-9_]*) \(action: ([a-z][a-z0-9_]*)\)/g;

/** `tool (action: x)` pairs the served prompts name. */
function mentionedActions(): Array<{ tool: string; action: string }> {
  const pairs = new Map<string, { tool: string; action: string }>();
  for (const { text } of servedPromptTexts()) {
    for (const match of text.matchAll(ACTION_PAIR)) {
      const [, tool = '', action = ''] = match;
      pairs.set(`${tool}.${action}`, { tool, action });
    }
  }
  return [...pairs.values()].sort((a, b) => `${a.tool}.${a.action}`.localeCompare(`${b.tool}.${b.action}`));
}

function mentionedToolNames(): string[] {
  const mentioned = new Set<string>();
  for (const { text } of servedPromptTexts()) {
    // The action of a `tool (action: x)` pair is checked against the tool's own actions below.
    for (const match of text.replace(ACTION_PAIR, '$1').matchAll(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g)) {
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

  it('blocks "is broken" as a stale provider status (PR #395 review)', () => {
    expect(STALE_STATUS_PHRASES).toContain('is broken');
    expect(STALE_STATUS_PHRASES.some((phrase) => 'Bluesky is broken'.includes(phrase))).toBe(true);
  });

  it('keeps Bluesky as an ordinary optional provider in full-setup', () => {
    expect(promptBase.FULL_SETUP_PROMPT).toContain('Bluesky is optional');
    expect(promptBase.FULL_SETUP_PROMPT).not.toContain('Bluesky video publishing');
  });

  it('keeps image recipe docs as hub pointers, not a retyped media cap', () => {
    const root = findRepoRoot(import.meta.url);
    const docs: Array<[string, string]> = [
      ['daily-news.md', 'https://post-engineer.com/recipes/daily-news'],
      ['place-spotlight.md', 'https://post-engineer.com/recipes/place-spotlight'],
      ['subject-spotlight.md', 'https://post-engineer.com/recipes/subject-spotlight'],
      ['github-prs.md', 'https://post-engineer.com/recipes/github-prs'],
    ];
    for (const [file, href] of docs) {
      const doc = readFileSync(join(root, 'docs', 'recipes', file), 'utf8');
      expect(doc).toContain(href);
      expect(doc).toContain('shared/prompt-base/prompt-base.ts');
      expect(doc).not.toContain('At most 6');
      expect(doc).not.toContain('at most 6');
      expect(doc).not.toContain('## Steps');
      expect(doc).not.toContain('## Limits');
    }
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
  it('finds registered tools, their actions and the tool names the prompts mention', () => {
    const registered = registeredTools();
    expect(registered.size).toBe(16);
    expect(registered.has('generate_video')).toBe(true);
    expect([...(registered.get('personas') ?? [])].sort()).toEqual(['create', 'delete', 'get', 'list', 'update']);
    expect(registered.get('generate_video')?.size).toBe(0);
    expect(mentionedToolNames().length).toBeGreaterThan(0);
    expect(mentionedActions().length).toBeGreaterThan(0);
  });

  it('registers every tool name mentioned in the served prompts', () => {
    const registered = registeredTools();
    const missing = mentionedToolNames().filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });

  it('only names an action that the tool really has', () => {
    const registered = registeredTools();
    const unknown = mentionedActions().filter(({ tool, action }) => !registered.get(tool)?.has(action));
    expect(unknown).toEqual([]);
  });

  it('never gives an action to a tool that has none', () => {
    const registered = registeredTools();
    for (const { tool } of mentionedActions()) {
      expect(registered.get(tool)?.size, `${tool} has no actions`).toBeGreaterThan(0);
    }
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
