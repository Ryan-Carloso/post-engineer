import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registeredToolActions, registeredToolNames, specKeys } from '@/scripts/mcp-tool-inventory.mjs';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const created: string[] = [];

function fixtureRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-inventory-'));
  created.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, 'apps', 'mcp', 'src', path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('mcp tool inventory reader', () => {
  it('maps every registered tool to its actions, with none missing or extra', () => {
    const names = registeredToolNames(root);
    const actions = registeredToolActions(root);

    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(actions).sort()).toEqual(names);
  });

  it('finds as many tools as the MCP server lists over a real transport', () => {
    const statsTest = readFileSync(
      join(root, 'apps', 'mcp', 'src', '__tests__', 'tools-list-stats.test.ts'),
      'utf8',
    );
    const pinned = /expect\(tools\)\.toHaveLength\((\d+)\)/.exec(statsTest);
    expect(pinned).not.toBeNull();
    expect(registeredToolNames(root)).toHaveLength(Number(pinned?.[1]));
  });

  it('reads the actions of tools that spread another spec object', () => {
    const actions = registeredToolActions(root);

    expect(actions.prompts).toEqual(
      expect.arrayContaining(['list', 'get', 'create', 'update', 'delete', 'versions', 'restore']),
    );
    expect(actions.insights).toContain('retention_curve');
    expect(actions.persona_media).toEqual(['get_card', 'render_prompt']);
  });

  it('accepts single and double quoted tool names and walks subdirectories', () => {
    const dir = fixtureRoot({
      'a.ts': "server.tool('alpha', 'd');",
      'nested/b.ts': 'server.tool("beta", "d");\nserver.tool(\n  \'gamma\',\n  "d");',
    });

    expect(registeredToolNames(dir)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('ignores registrations inside __tests__ directories and declaration files', () => {
    const dir = fixtureRoot({
      'a.ts': "server.tool('alpha', 'd');",
      '__tests__/b.ts': "server.tool('fake', 'd');",
      'nested/__tests__/c.ts': "server.tool('fake_nested', 'd');",
      'types.d.ts': "server.tool('declared', 'd');",
    });

    expect(registeredToolNames(dir)).toEqual(['alpha']);
  });

  it('matches a spec constant by its whole name, with or without a type annotation', () => {
    const dir = fixtureRoot({
      'intent-personas.ts': [
        'const PERSONA_MEDIA_SPECS = { wrong: 1 };',
        'const MEDIA_SPECS_EXTRA = { also_wrong: 1 };',
        'const MEDIA_SPECS: Record<string, unknown> = { list_faces: A, add_image: B };',
        'const BARE_SPECS={ tight: A };',
      ].join('\n'),
    });

    expect(specKeys(dir, 'intent-personas.ts', 'MEDIA_SPECS')).toEqual(['list_faces', 'add_image']);
    expect(specKeys(dir, 'intent-personas.ts', 'BARE_SPECS')).toEqual(['tight']);
    expect(() => specKeys(dir, 'intent-personas.ts', 'MISSING_SPECS')).toThrow(/not found/);
  });

  it('reads keys after a comma, an opening brace or a line break, never a ternary arm', () => {
    const dir = fixtureRoot({
      'tools-x.ts': [
        'const X_SPECS = {',
        '  first: A,',
        '  mode: flag ? alpha : beta,',
        '  second: { nested_key: B },',
        '  ...MORE_SPECS,',
        '  third: C };',
      ].join('\n'),
      'more.ts': 'const MORE_SPECS = {\n  spread_key: A };',
    });

    expect(specKeys(dir, 'tools-x.ts', 'X_SPECS')).toEqual([
      'first',
      'mode',
      'second',
      'third',
      'spread_key',
    ]);
  });

  it('follows a spread spec object into the file that declares it', () => {
    const dir = fixtureRoot({
      'tools-prompts.ts': 'const PROMPTS_SPECS = { list: A, ...MORE_SPECS };',
      'nested/more.ts': 'const MORE_SPECS = { restore: A };',
    });

    expect(specKeys(dir, 'tools-prompts.ts', 'PROMPTS_SPECS')).toEqual(['list', 'restore']);
  });

  it('throws when a spread spec object has no owner', () => {
    const dir = fixtureRoot({
      'tools-prompts.ts': 'const PROMPTS_SPECS = { list: A, ...GHOST_SPECS };',
    });

    expect(() => specKeys(dir, 'tools-prompts.ts', 'PROMPTS_SPECS')).toThrow(/GHOST_SPECS/);
  });
});
