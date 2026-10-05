import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseYamlSubset } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_CONFIG = path.resolve(HERE, '..', '..', 'api-naming.yml');

describe('parseYamlSubset', () => {
  it('parses scalars, lists and one-level nested maps', () => {
    const cfg = parseYamlSubset(`
key: value
count: 20
flag: true
items:
  - "a"
  - b
nested:
  replay:
    severity: error
    reason: "too vague"
`);
    assert.equal(cfg.key, 'value');
    assert.equal(cfg.count, 20);
    assert.equal(cfg.flag, true);
    assert.deepEqual(cfg.items, ['a', 'b']);
    assert.deepEqual(cfg.nested.replay, { severity: 'error', reason: 'too vague' });
  });

  it('ignores comments and blank lines', () => {
    const cfg = parseYamlSubset('# comment\n\nkey: value # trailing\n');
    assert.deepEqual(cfg, { key: 'value' });
  });

  it('rejects unknown top-level keys: exceptions cannot be reintroduced', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-naming-test-'));
    const file = path.join(dir, 'api-naming.yml');
    fs.writeFileSync(
      file,
      [
        'api_paths:',
        '  - "apps/web/app/api/**/route.ts"',
        'denylist:',
        '  data:',
        '    severity: error',
        '    reason: "vague"',
        'exceptions:',
        '  - path: "apps/engine/app/models/schema.py"',
        '    names: ["data"]',
        '    reason: "legacy"',
        '',
      ].join('\n'),
    );
    assert.throws(() => loadConfig(file), /unknown top-level key "exceptions"/);
    assert.throws(() => loadConfig(file), /rename the identifier instead/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('loadConfig (real .github/api-naming.yml)', () => {
  it('loads contract paths', () => {
    const cfg = loadConfig(REPO_CONFIG);
    assert.ok(Array.isArray(cfg.apiPaths) && cfg.apiPaths.length > 0);
    assert.ok(cfg.apiPaths.some((p) => p.includes('apps/web/app/api')));
    assert.ok(cfg.apiPaths.some((p) => p.includes('apps/mcp')));
    assert.ok(cfg.apiPaths.some((p) => p.includes('apps/engine')));
  });

  it('loads the full initial denylist with severities', () => {
    const cfg = loadConfig(REPO_CONFIG);
    for (const name of [
      'replay',
      'data',
      'info',
      'result',
      'value',
      'item',
      'thing',
      'stuff',
      'payload',
    ]) {
      assert.ok(cfg.denylist[name], `denylist should contain ${name}`);
      assert.equal(cfg.denylist[name].severity, 'error');
      assert.ok(cfg.denylist[name].reason.length > 0);
    }
  });

  it('loads allowlist and llm settings (no exceptions mechanism)', () => {
    const cfg = loadConfig(REPO_CONFIG);
    assert.ok(cfg.allowlist.includes('id'));
    assert.ok(!('exceptions' in cfg), 'config must not expose exceptions');
    assert.equal(cfg.llm.enabled, true);
    assert.ok(cfg.llm.model.length > 0);
    assert.ok(cfg.llm.baseUrl.startsWith('https://'));
    assert.equal(cfg.llm.maxNames, 20);
  });

  it('throws a clear error for a missing denylist', () => {
    assert.throws(() => loadConfig('/nonexistent/api-naming.yml'), /not found|ENOENT/i);
  });
});
