import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changedExclusions } from './diff.mjs';

test('reports no change for identical entries', () => {
  const base = {
    'GET /api/a': { kind: 'session-only' },
    'GET /api/b': { kind: 'covered-by', tools: ['list_posts'] },
  };
  assert.deepEqual(changedExclusions(base, structuredClone(base)), {
    added: [],
    modified: [],
  });
});

test('reports a newly added exclusion', () => {
  const base = { 'GET /api/a': { kind: 'session-only' } };
  const head = {
    'GET /api/a': { kind: 'session-only' },
    'GET /api/new': { kind: 'ops-public' },
  };
  assert.deepEqual(changedExclusions(base, head), {
    added: ['GET /api/new'],
    modified: [],
  });
});

test('reports a changed kind or payload', () => {
  const base = {
    'GET /api/a': { kind: 'session-only' },
    'GET /api/b': { kind: 'covered-by', tools: ['list_posts'] },
  };
  const head = {
    'GET /api/a': { kind: 'secret-auth', mechanism: 'cron-secret' },
    'GET /api/b': { kind: 'covered-by', tools: ['get_post'] },
  };
  assert.deepEqual(changedExclusions(base, head), {
    added: [],
    modified: ['GET /api/a', 'GET /api/b'],
  });
});

test('removals are not a change requiring approval', () => {
  const base = {
    'GET /api/a': { kind: 'session-only' },
    'GET /api/gone': { kind: 'ops-public' },
  };
  const head = { 'GET /api/a': { kind: 'session-only' } };
  assert.deepEqual(changedExclusions(base, head), {
    added: [],
    modified: [],
  });
});

test('a missing base file counts every head entry as added', () => {
  const head = { 'GET /api/a': { kind: 'session-only' } };
  assert.deepEqual(changedExclusions({}, head), {
    added: ['GET /api/a'],
    modified: [],
  });
});

test('invalid shapes do not crash', () => {
  assert.deepEqual(changedExclusions(null, ['nope']), {
    added: [],
    modified: [],
  });
});
