// Prompts hub copy guard: the prompts served over MCP (slash commands in
// Cursor / Claude) must be an exact copy of the web hub, the source of
// truth parsed as text (apps/web/app/recipes/prompts.ts for slugs,
// apps/web/lib/i18n/recipes-i18n-en.ts for title + description).
// This test fails loudly whenever the MCP copy drifts from the sources.
// It never imports apps/web at runtime: the published MCP tarball must be
// self-contained (see shared/README.md).
// Prompt text itself is not copied: web imports it directly from
// shared/prompt-base, MCP through a symlink to the same file, and each
// web entry must name the same export the MCP serves.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUB_PROMPTS } from '../prompts.js';
import * as promptBase from '../prompt-base.js';

function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    }
    dir = parent;
  }
}

const root = findRepoRoot(import.meta.url);
const webPromptsSource = readFileSync(
  join(root, 'apps', 'web', 'app', 'recipes', 'prompts.ts'),
  'utf8',
);
const webI18nSource = readFileSync(
  join(root, 'apps', 'web', 'lib', 'i18n', 'recipes-i18n-en.ts'),
  'utf8',
);

// Unescape a quoted TS literal body without inventing characters.
function unquote(body: string): string {
  return body.replace(/\\(.)/g, (_, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    return ch;
  });
}

// Prompt entries in the PROMPTS array: slug, titleKey, objectiveKey, prompt.
interface HubEntry {
  slug: string;
  titleKey: string;
  objectiveKey: string;
  promptConst: string;
}
const entryStarts = [...webPromptsSource.matchAll(/slug: ['"]([\w-]+)['"]/g)];
const webEntries: HubEntry[] = entryStarts.map((start, i) => {
  const chunk = webPromptsSource.slice(
    start.index,
    entryStarts[i + 1]?.index ?? webPromptsSource.length,
  );
  return {
    slug: start[1],
    titleKey: chunk.match(/titleKey: ['"]([\w.]+)['"]/)?.[1] ?? '',
    objectiveKey: chunk.match(/objectiveKey: ['"]([\w.]+)['"]/)?.[1] ?? '',
    promptConst: chunk.match(/prompt:\s*([A-Z][A-Z0-9_]+)/)?.[1] ?? '',
  };
});

// i18n flat keys → values (recipes.* keys live unqualified in the dictionary).
const i18nValues = new Map<string, string>();
for (const m of webI18nSource.matchAll(
  /([A-Za-z0-9]+):\s*\n?\s*'((?:[^'\\\n]|\\.)*)'/g,
)) {
  i18nValues.set(m[1], unquote(m[2]));
}

describe('MCP prompts sync with the web hub', () => {
  it('has at least one hub prompt to serve', () => {
    expect(HUB_PROMPTS.length).toBeGreaterThan(0);
    expect(webEntries.length).toBeGreaterThan(0);
  });

  it('uses the same slugs in the same order as the web PROMPTS array', () => {
    expect(HUB_PROMPTS.map((p) => p.slug)).toEqual(webEntries.map((e) => e.slug));
  });

  for (const entry of webEntries) {
    const webTitle = i18nValues.get(entry.titleKey.replace(/^recipes\./, ''));
    const webDescription = i18nValues.get(entry.objectiveKey.replace(/^recipes\./, ''));
    const webText = new Map<string, unknown>(Object.entries(promptBase)).get(entry.promptConst);
    expect(webTitle, `i18n ${entry.titleKey} parsed`).toBeTruthy();
    expect(webDescription, `i18n ${entry.objectiveKey} parsed`).toBeTruthy();
    expect(webText, `web prompt ${entry.promptConst} parsed`).toBeTruthy();

    const mcpPrompt = HUB_PROMPTS.find((p) => p.slug === entry.slug);
    it(`prompt ${entry.slug}: exact web copy drifts fail loudly (name = slug, title, description, text)`, () => {
      expect(mcpPrompt).toBeTruthy();
      expect(mcpPrompt?.title).toBe(webTitle);
      expect(mcpPrompt?.description).toBe(webDescription);
      expect(mcpPrompt?.prompt).toBe(webText);
    });
  }

  it('every served prompt starts with the shared base', () => {
    const baseText = promptBase.SHARED_PROMPT_BASE.join('\n');
    expect(baseText).toContain('No em dashes');
    expect(HUB_PROMPTS.length).toBeGreaterThan(0);
    for (const prompt of HUB_PROMPTS) {
      expect(prompt.prompt.startsWith(`${baseText}\n\n`)).toBe(true);
    }
  });
});
