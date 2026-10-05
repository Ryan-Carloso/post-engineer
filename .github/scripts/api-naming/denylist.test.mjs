import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkDenylist } from './denylist.mjs';
import { matchesGlob } from './extract.mjs';

const BASE_CONFIG = {
  apiPaths: [],
  denylist: {
    replay: { severity: 'error', reason: 'Unclear: replaying data, rerunning a job, or retrying?' },
    data: { severity: 'error', reason: 'Says nothing about the payload.' },
    info: { severity: 'warn', reason: 'Vague.' },
  },
  allowlist: ['id'],
  llm: { enabled: true, baseUrl: '', model: '', maxNames: 20, timeoutMs: 30000 },
};

function candidate(name, file = 'apps/web/app/api/x/route.ts', line = 1) {
  return { file, line, name, context: `${name}: true`, renamedFrom: null };
}

describe('checkDenylist', () => {
  it('fails exact denylisted names', () => {
    const findings = checkDenylist([candidate('replay')], BASE_CONFIG);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'error');
    assert.equal(findings[0].name, 'replay');
    assert.match(findings[0].reason, /Unclear/);
    assert.equal(findings[0].source, 'denylist');
  });

  it('matches case-insensitively', () => {
    const findings = checkDenylist([candidate('REPLAY')], BASE_CONFIG);
    assert.equal(findings.length, 1);
  });

  it('does not substring-match: replayed and replayCount pass the deterministic layer', () => {
    assert.deepEqual(checkDenylist([candidate('replayed')], BASE_CONFIG), []);
    assert.deepEqual(checkDenylist([candidate('replayCount')], BASE_CONFIG), []);
    assert.deepEqual(checkDenylist([candidate('metadata')], BASE_CONFIG), []);
  });

  it('respects warn severity from config', () => {
    const findings = checkDenylist([candidate('info')], BASE_CONFIG);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'warn');
  });

  it('has no exceptions mechanism: denylisted names fail in every path', () => {
    const findings = checkDenylist(
      [candidate('data', 'apps/engine/app/models/schema.py', 320)],
      BASE_CONFIG,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'error');
  });

  it('still flags denylisted names outside the exception path', () => {
    const findings = checkDenylist(
      [candidate('data', 'apps/web/app/api/billing/tokens/route.ts', 42)],
      BASE_CONFIG,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'error');
  });

  it('allowlist wins over the denylist', () => {
    const cfg = {
      ...BASE_CONFIG,
      denylist: { ...BASE_CONFIG.denylist, id: { severity: 'error', reason: 'x' } },
    };
    assert.deepEqual(checkDenylist([candidate('id')], cfg), []);
  });

  it('keeps file/line/rename context on the finding', () => {
    const findings = checkDenylist(
      [{ ...candidate('replay', 'apps/mcp/src/tools.ts', 99), renamedFrom: 'payload' }],
      BASE_CONFIG,
    );
    assert.equal(findings[0].file, 'apps/mcp/src/tools.ts');
    assert.equal(findings[0].line, 99);
    assert.equal(findings[0].renamedFrom, 'payload');
  });
});

describe('matchesGlob (glob matching for apiPaths)', () => {
  it('matches exception paths with **', () => {
    assert.ok(matchesGlob('apps/engine/app/models/schema.py', 'apps/engine/app/models/schema.py'));
    assert.ok(!matchesGlob('apps/engine/app/models/other.py', 'apps/engine/app/models/schema.py'));
  });
});
