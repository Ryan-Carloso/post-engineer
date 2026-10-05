import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderComment, COMMENT_MARKER } from './comment.mjs';

const FINDINGS = {
  uiFiles: ['apps/web/app/(main)/account/page.tsx', 'apps/web/components/ui/account-panel.tsx'],
  vitest: { covered: 7, total: 10, status: 'pass' },
  cypress: {
    covered: 5, total: 8, status: 'pass',
    inScope: ['apps/web/app/(main)/account/page.tsx'],
    exempt: ['apps/web/components/ui/account-panel.tsx'],
  },
  mutation: { score: 66, killed: 3, survived: 2, timeout: 1, total: 6, status: 'pass' },
  pass: true,
};

describe('renderComment', () => {
  it('includes the marker for upserts', () => {
    assert.ok(renderComment(FINDINGS).includes(COMMENT_MARKER));
  });

  it('renders one row per gate with percentage and threshold', () => {
    const body = renderComment(FINDINGS);
    assert.ok(body.includes('70.0%'));
    assert.equal(body.includes('≥ 80%'), true);
    assert.ok(body.includes('62.5%'));
    assert.ok(body.includes('66%'));
    assert.equal(body.includes('≥ 60%'), true);
  });

  it('marks failing gates', () => {
    const failing = { ...FINDINGS, vitest: { covered: 5, total: 10, status: 'fail' }, pass: false };
    const body = renderComment(failing);
    assert.ok(body.includes('❌'));
    assert.ok(body.includes('✅'));
  });

  it('lists cypress-exempt files with the reason', () => {
    const body = renderComment(FINDINGS);
    assert.ok(body.includes('apps/web/components/ui/account-panel.tsx'));
    assert.ok(body.includes('outside the cypress-coverage instrumentation scope'));
  });

  it('renders n/a gates without failing', () => {
    const na = {
      uiFiles: ['apps/web/app/(main)/account/page.tsx'],
      vitest: { status: 'na', reason: 'no coverable lines' },
      cypress: { status: 'na', reason: 'no UI files in cypress scope' },
      mutation: { status: 'na', reason: 'no mutants' },
      pass: true,
    };
    const body = renderComment(na);
    assert.ok(body.includes('n/a'));
    assert.ok(!body.includes('❌'));
  });

  it('renders missing reports as failures (fail-closed)', () => {
    const missing = {
      uiFiles: ['apps/web/app/page.tsx'],
      vitest: { status: 'missing', reason: 'cobertura report not found' },
      cypress: { status: 'na', reason: 'no UI files in cypress scope' },
      mutation: { status: 'na', reason: 'no mutants' },
      pass: false,
    };
    const body = renderComment(missing);
    assert.ok(body.includes('❌'));
    assert.ok(body.includes('cobertura report not found'));
  });
});
