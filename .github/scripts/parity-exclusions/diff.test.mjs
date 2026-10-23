import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXCLUSIONS_PATH, evaluateChanges, exclusionChanges, isGuarded } from './diff.mjs';

const data = (exclusions, opsPublic = []) => ({ opsPublic, exclusions });

test('reports no change for identical data', () => {
  const base = data({ 'GET /api/a': { kind: 'session-only' } }, ['GET /api/version']);
  assert.deepEqual(exclusionChanges(base, structuredClone(base)), {
    added: [],
    modified: [],
    opsPublicAdded: [],
    problems: [],
  });
});

test('reports added and changed exclusions and added opsPublic entries', () => {
  const base = data({ 'GET /api/a': { kind: 'session-only' } });
  const head = data(
    {
      'GET /api/a': { kind: 'secret-auth', mechanism: 'cron-secret' },
      'GET /api/new': { kind: 'ops-public' },
    },
    ['GET /api/new'],
  );
  const diff = exclusionChanges(base, head);
  assert.deepEqual(diff.added, ['GET /api/new']);
  assert.deepEqual(diff.modified, ['GET /api/a']);
  assert.deepEqual(diff.opsPublicAdded, ['GET /api/new']);
});

test('removals alone need no approval', () => {
  const base = data({ 'GET /api/a': { kind: 'session-only' }, 'GET /api/gone': { kind: 'ops-public' } }, ['GET /api/gone']);
  const head = data({ 'GET /api/a': { kind: 'session-only' } });
  assert.deepEqual(evaluateChanges([EXCLUSIONS_PATH], { base, head }), { needsApproval: false, reasons: [] });
});

test('malformed or deleted exclusion data fails closed', () => {
  const base = data({ 'GET /api/a': { kind: 'session-only' } });
  assert.equal(evaluateChanges([EXCLUSIONS_PATH], { base, head: ['nope'] }).needsApproval, true);
  assert.equal(evaluateChanges([EXCLUSIONS_PATH], { base, head: { unparseable: true } }).needsApproval, true);
  assert.equal(evaluateChanges([EXCLUSIONS_PATH], { base, head: undefined }).needsApproval, true);
  assert.equal(
    evaluateChanges([EXCLUSIONS_PATH], { base, head: { ...base, extra: 1 } }).needsApproval,
    true,
  );
});

test('a missing base file counts every head entry as added', () => {
  const head = data({ 'GET /api/a': { kind: 'session-only' } });
  assert.deepEqual(exclusionChanges(undefined, head).added, ['GET /api/a']);
});

test('any change to the parity test, verifier, guard or CODEOWNERS needs approval', () => {
  for (const file of [
    'apps/mcp/src/__tests__/web-api-parity.test.ts',
    'apps/mcp/src/__tests__/parity-verifier.test.ts',
    'apps/mcp/src/__tests__/parity/exclusions.ts',
    'apps/mcp/src/__tests__/parity/new-helper.ts',
    'apps/web/app/api/__tests__/parity-exclusion-bearer.test.ts',
    '.github/scripts/parity-exclusions/check.mjs',
    '.github/workflows/parity-exclusion-guard.yml',
    '.github/CODEOWNERS',
  ]) {
    assert.equal(isGuarded(file), true, file);
    assert.deepEqual(evaluateChanges([file], { base: undefined, head: undefined }), {
      needsApproval: true,
      reasons: [`guarded file changed: ${file}`],
    });
  }
});

test('the proven tool mapping and ordinary code are not guarded', () => {
  for (const file of [
    'apps/mcp/src/__tests__/parity-endpoint-tools.json',
    'apps/mcp/src/index.ts',
    'apps/web/app/api/metrics/route.ts',
    'apps/mcp/src/__tests__/parity-helpers.ts',
  ]) {
    assert.equal(isGuarded(file), false, file);
  }
  assert.equal(evaluateChanges(['apps/mcp/src/index.ts'], { base: undefined, head: undefined }).needsApproval, false);
});
