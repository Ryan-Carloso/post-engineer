import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HOME, MIRRORS, findViolations, loadProviders, run, scanPython, selectSources } from './check.mjs';
import { buildMentionIndex, mentionsInText } from './mentions.mjs';
import { violationOf } from './rules.mjs';
import { scanTs } from './scan-ts.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const loaded = await loadProviders(root);
const { providers, subsets } = loaded;
const index = buildMentionIndex(providers, loaded.columns);
const ALL = providers.map((provider) => `'${provider}'`).join(', ');

const tsKinds = (text, file = 'apps/web/lib/x.ts') => scanTs(file, text, index).map((group) => [group.kind, [...new Set(group.providers)].length]);
const tsViolations = (text, file = 'apps/web/lib/x.ts') => findViolations(scanTs(file, text, index), loaded, []);

describe('loadProviders', () => {
  it('reads the list and the named subsets from the home file', () => {
    assert.equal(providers.length, 10);
    assert.deepEqual([...subsets.DIRECT_CONNECT_PROVIDERS], ['bluesky', '3speak', 'rumble']);
    assert.ok('OAUTH_CONNECT_PROVIDERS' in subsets);
    assert.ok('IMAGE_PROVIDERS' in subsets);
    assert.ok('TITLE_PROVIDERS' in subsets);
    assert.ok(!('SOCIAL_PROVIDERS' in subsets));
  });
});

describe('mentions', () => {
  it('maps a provider, its column, the camelCase column and the engine constant', () => {
    assert.deepEqual(mentionsInText(index, '3speak threespeak_account_ids threespeakAccountIds THREESPEAK_PROVIDER'), ['3speak', '3speak', '3speak', '3speak']);
    assert.deepEqual(mentionsInText(index, 'YouTube igAccountIds did'), []);
  });
});

describe('violationOf', () => {
  const at = (kind, named, home = false) => violationOf({ file: 'f', line: 1, kind, providers: named }, { providers, subsets, home });
  it('ignores a group under three providers', () => {
    assert.equal(at('list', ['youtube', 'rumble']), null);
    assert.equal(at('chain', ['youtube', 'rumble', 'youtube']), null);
  });
  it('flags any list outside a home file, even a full copy or a named subset', () => {
    assert.match(at('list', ['bluesky', '3speak', 'rumble']), /hand-typed provider list/);
    assert.match(at('list', [...providers]), /hand-typed provider list/);
    assert.equal(at('list', [...providers], true), null);
  });
  it('flags a chain everywhere, home files included', () => {
    assert.match(at('chain', ['youtube', 'instagram', 'bluesky']), /per-provider chain/);
    assert.match(at('chain', ['youtube', 'instagram', 'bluesky'], true), /per-provider chain/);
  });
  it('allows a map or string that names every provider or exactly a named subset', () => {
    assert.equal(at('map', [...providers]), null);
    assert.equal(at('map', ['bluesky', '3speak', 'rumble']), null);
    assert.equal(at('text', [...subsets.OAUTH_CONNECT_PROVIDERS]), null);
  });
  it('flags a map or string that skips a provider and names the missing ones', () => {
    assert.match(at('map', providers.filter((provider) => provider !== 'fanvue')), /per-provider map names 9 of 10 providers, missing: fanvue/);
    assert.match(at('text', ['youtube', 'instagram', 'bluesky']), /string names 3 of 10/);
    assert.match(at('map', providers.filter((provider) => provider !== 'fanvue'), true), /missing: fanvue/);
  });
});

describe('scanTs', () => {
  it('finds arrays and string unions', () => {
    assert.deepEqual(tsKinds(`const a = [${ALL}];`), [['list', 10]]);
    assert.deepEqual(tsKinds("type P = 'youtube' | 'instagram' | 'linkedin';"), [['list', 3]]);
  });
  it('finds object maps with quoted, unquoted and computed keys, and interface members', () => {
    assert.deepEqual(tsKinds("const m = { youtube: 1, 'instagram': 2, ['bluesky']: 3 };"), [['map', 3]]);
    assert.deepEqual(tsKinds('interface S { youtubeAccountIds: string[]; instagramAccountIds: string[]; rumbleAccountIds: string[] }'), [['map', 3]]);
    assert.deepEqual(tsKinds('type S = { youtube_account_ids: string[]; instagram_account_ids: string[]; rumble_account_ids: string[] };'), [['map', 3]]);
  });
  it('finds ternary, if/else-if, ||, and switch chains once each', () => {
    assert.deepEqual(tsKinds("const h = p === 'youtube' ? a : p === 'instagram' ? b : p === 'bluesky' ? c : d;"), [['chain', 3]]);
    assert.deepEqual(tsKinds("if (p === 'youtube') a(); else if (p === 'instagram') b(); else if (p === 'bluesky') c();"), [['chain', 3]]);
    assert.deepEqual(tsKinds("const t = p === 'youtube' || p === 'rumble' || p === 'fanvue';"), [['chain', 3]]);
    assert.deepEqual(tsKinds("switch (p) { case 'youtube': break; case 'instagram': break; case 'bluesky': break; }"), [['chain', 3]]);
  });
  it('finds providers inside a string and a template literal', () => {
    assert.deepEqual(tsKinds("const s = 'id, youtube_account_ids, instagram_account_ids, rumble_account_ids';"), [['text', 3]]);
    assert.deepEqual(tsKinds('const s = `for youtube/instagram/${x} and bluesky`;'), [['text', 3]]);
  });
  it('reports nothing for single providers and for constants read by name', () => {
    assert.deepEqual(tsKinds("if (p === 'youtube') a(); const l = SOCIAL_PROVIDERS.map((x) => x); const f = PUBLISH_ACCOUNT_FIELDS[p];"), []);
  });
  it('finds runs of sibling if statements that share a subject', () => {
    assert.deepEqual(tsKinds("if (p === 'youtube') a();\nif (p === 'instagram') b();\nif (p === 'bluesky') c();\n"), [['chain', 3]]);
    assert.deepEqual(tsKinds("if (a.provider === 'youtube') a();\nif (a.provider === 'instagram') b();\nif (a.provider === 'bluesky') c();\n"), [['chain', 3]]);
    assert.deepEqual(tsKinds("if (p === 'youtube') a();\nif (p === 'instagram') b();\n"), [['chain', 2]]);
    assert.deepEqual(tsKinds("if (p === 'youtube') a();\nwork();\nif (p === 'instagram') b();\nif (p === 'bluesky') c();\n"), [['chain', 2]]);
    assert.deepEqual(tsKinds("if (p === 'youtube') a();\nif (q === 'instagram') b();\nif (q === 'bluesky') c();\n"), [['chain', 2]]);
    const violations = tsViolations("if (p === 'youtube') a();\nif (p === 'instagram') b();\nif (p === 'bluesky') c();\n");
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /per-provider chain/);
  });
  it('turns the findings into violations with the line of the node', () => {
    const violations = tsViolations("const x = 1;\nconst P = ['youtube', 'instagram', 'linkedin'];\n");
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.match(violations[0].message, /hand-typed provider list/);
  });
  it('still finds the list in its one home (the scanner is not vacuous)', () => {
    const groups = scanTs(HOME, readFileSync(join(root, HOME), 'utf8'), index);
    assert.ok(groups.some((group) => group.kind === 'list' && new Set(group.providers).size === providers.length));
    assert.deepEqual(findViolations(groups, loaded, []), []);
  });
});

describe('scanPython', () => {
  const python = (text) => {
    const dir = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    const file = join(dir, 'sample.py');
    execFileSync('sh', ['-c', 'cat > "$1"', 'sh', file], { input: text });
    try {
      return scanPython(root, [file], index).map((group) => [group.kind, [...new Set(group.providers)].length]);
    } finally {
      execFileSync('rm', ['-rf', dir]);
    }
  };
  it('finds tuples, sets of engine constants and Literal[...]', () => {
    assert.deepEqual(python('A = ("youtube", "instagram", "bluesky")\n'), [['list', 3]]);
    assert.deepEqual(python('A = frozenset({INSTAGRAM_PROVIDER, THREADS_PROVIDER, FACEBOOK_PROVIDER})\n'), [['list', 3]]);
    assert.deepEqual(
      python('from typing import Literal\nP = Literal["youtube", "instagram", "bluesky"]\n').sort(),
      [['list', 3], ['list', 3]],
    );
  });
  it('finds dicts keyed by provider and if/elif and boolean chains', () => {
    assert.deepEqual(python('M = {"youtube": 1, "instagram": 2, "bluesky": 3}\n'), [['map', 3]]);
    assert.deepEqual(python('if p == "youtube":\n    a()\nelif p == "instagram":\n    b()\nelif p == "bluesky":\n    c()\n'), [['chain', 3]]);
    assert.deepEqual(python('ok = p == "youtube" or p == "rumble" or p == "fanvue"\n'), [['chain', 3]]);
  });
  it('finds runs of sibling if statements that share a subject', () => {
    assert.deepEqual(python('if p == "youtube":\n    a()\nif p == "instagram":\n    b()\nif p == "bluesky":\n    c()\n'), [['chain', 3]]);
    assert.deepEqual(python('if p == YOUTUBE_PROVIDER:\n    a()\nif p == INSTAGRAM_PROVIDER:\n    b()\nif p == BLUESKY_PROVIDER:\n    c()\n'), [['chain', 3]]);
    assert.deepEqual(python('if p == "youtube":\n    a()\nif p == "instagram":\n    b()\n'), [['chain', 2]]);
    assert.deepEqual(python('if p == "youtube":\n    a()\nwork()\nif p == "instagram":\n    b()\nif p == "bluesky":\n    c()\n'), [['chain', 2]]);
  });
  it('reads an implicitly concatenated select string as one string and skips docstrings', () => {
    assert.deepEqual(python('"""youtube instagram bluesky"""\nS = (\n    "youtube_account_ids,"\n    "instagram_account_ids,bluesky_account_ids"\n)\n'), [['text', 3]]);
  });
});

describe('findViolations (mirrors)', () => {
  it('accepts a mirror that lists every provider and flags one that drifted', () => {
    const mirror = 'apps/engine/app/providers.py';
    const full = { file: mirror, line: 3, kind: 'list', providers: [...providers] };
    assert.deepEqual(findViolations([full], loaded, [mirror]), []);
    const drifted = { ...full, providers: providers.filter((provider) => provider !== 'fanvue') };
    const violations = findViolations([drifted], loaded, [mirror]);
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /mirror of SOCIAL_PROVIDERS/);
  });
});

describe('selectSources', () => {
  it('keeps production sources and drops tests, cypress and generated files', () => {
    const { ts, py } = selectSources([
      'apps/web/lib/a.ts',
      'apps/web/lib/__tests__/a.test.ts',
      'apps/web/cypress/e2e/a.cy.ts',
      'apps/web/lib/supabase/database.gen.ts',
      'apps/mcp/src/b.ts',
      'apps/mcp/README.md',
      '.github/scripts/x.mjs',
      'supabase/migrations/001.sql',
      'apps/engine/app/c.py',
      'apps/engine/test/test_c.py',
    ]);
    assert.deepEqual(ts, ['apps/web/lib/a.ts', 'apps/mcp/src/b.ts']);
    assert.deepEqual(py, ['apps/engine/app/c.py']);
  });
});

describe('the repository', () => {
  it('has every mirror among the scanned sources', () => {
    const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n');
    const { ts, py } = selectSources(tracked);
    for (const mirror of MIRRORS) assert.ok(ts.includes(mirror) || py.includes(mirror), mirror);
  });
  it('is clean', async () => {
    assert.deepEqual(await run(root), []);
  });
});
