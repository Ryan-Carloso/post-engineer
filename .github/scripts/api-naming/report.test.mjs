import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatAnnotations, buildCommentBody } from './report.mjs';

const DENY_FINDING = {
  file: 'apps/web/app/api/x/route.ts',
  line: 13,
  name: 'replay',
  severity: 'error',
  reason: 'Unclear from the JSON alone: replaying data, rerunning a job, or retrying execution?',
  alternatives: [],
  source: 'denylist',
  renamedFrom: null,
};

const LLM_FINDING = {
  file: 'apps/engine/app/models/schema.py',
  line: 302,
  name: 'retry',
  severity: 'warn',
  reason: 'Ambiguous: could be a boolean, a count, or an object.',
  alternatives: ['retryCount', 'attemptCount'],
  source: 'llm',
  renamedFrom: null,
};

describe('formatAnnotations', () => {
  it('emits ::error for error findings with file and line', () => {
    const out = formatAnnotations([DENY_FINDING], []);
    assert.match(out, /^::error file=apps\/web\/app\/api\/x\/route\.ts,line=13::/m);
    assert.match(out, /Field "replay"/);
    assert.match(out, /Unclear from the JSON alone/);
  });

  it('emits ::warning for warn findings', () => {
    const out = formatAnnotations([LLM_FINDING], []);
    assert.match(out, /^::warning file=apps\/engine\/app\/models\/schema\.py,line=302::/m);
    assert.match(out, /retryCount/);
  });

  it('emits standalone ::warning lines for run warnings', () => {
    const out = formatAnnotations([], ['LLM key missing — skipped.']);
    assert.match(out, /^::warning::LLM key missing — skipped\.$/m);
  });

  it('escapes newlines in annotation messages', () => {
    const out = formatAnnotations([{ ...DENY_FINDING, reason: 'line1\nline2' }], []);
    assert.ok(!out.split('\n').some((l) => l.startsWith('::error') && l.includes('\n')));
    assert.match(out, /line1%0Aline2/);
  });
});

describe('buildCommentBody', () => {
  it('matches the required failure shape for a denylist error', () => {
    const body = buildCommentBody([DENY_FINDING], [], { headSha: 'abc123' });
    assert.match(body, /<!-- api-naming-lint -->/);
    assert.match(body, /❌ API naming issue/);
    assert.match(body, /Field: replay/);
    assert.match(body, /Problem: Unclear from the JSON alone/);
    assert.match(body, /apps\/web\/app\/api\/x\/route\.ts:13/);
  });

  it('renders LLM warnings with ⚠️ and suggested alternatives', () => {
    const body = buildCommentBody([LLM_FINDING], [], { headSha: 'abc123' });
    assert.match(body, /⚠️ API naming warning/);
    assert.match(body, /Field: retry/);
    assert.match(body, /Suggested alternatives:/);
    assert.match(body, /^\* retryCount$/m);
    assert.match(body, /^\* attemptCount$/m);
  });

  it('notes renamed fields', () => {
    const body = buildCommentBody([{ ...DENY_FINDING, renamedFrom: 'payload' }], [], { headSha: 'x' });
    assert.match(body, /renamed from `payload`/);
  });

  it('includes a warnings section when the run had warnings', () => {
    const body = buildCommentBody([DENY_FINDING], ['LLM skipped: no key.'], { headSha: 'x' });
    assert.match(body, /LLM skipped: no key\./);
  });

  it('renders an all-clear body when there are no findings', () => {
    const body = buildCommentBody([], [], { headSha: 'abc123' });
    assert.match(body, /✅ No API naming issues/);
    assert.match(body, /<!-- api-naming-lint -->/);
  });
});
