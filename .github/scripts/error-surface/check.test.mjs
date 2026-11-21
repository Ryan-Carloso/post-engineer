import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findDiscardedErrorViolations, findViolations, isCheckedFile } from './check.mjs';

const BARE_CATCH_REPORTS = `async function connect() {
  try {
    await fetch('/api/connect', { method: 'POST' });
  } catch {
    setError(t('accounts.connectError'));
  }
}`;

const BOUND_BUT_UNUSED = `async function submit() {
  try {
    await saveAccounts();
  } catch (error) {
    setResult({ success: false, error: t('persona.saveError') });
  }
}`;

const SURFACED_MESSAGE = `async function submit() {
  try {
    await saveAccounts();
  } catch (error) {
    setResult({ success: false, error: error instanceof Error && error.message !== '' ? error.message : t('persona.saveError') });
  }
}`;

const LOGGED_BUT_NOT_SHOWN = `async function load() {
  try {
    await fetchBalance();
  } catch (error) {
    logger.warn('balance fetch failed', { error });
    setError(t('billing.balanceError'));
  }
}`;

const NO_REPORT = `function readView() {
  try {
    return window.localStorage.getItem('view');
  } catch {
    return 'chart';
  }
}`;

const PROMISE_CATCH = `function save() {
  putAccounts().catch(() => setError(t('persona.saveError')));
}`;

const NESTED_CATCH = `async function submit() {
  try {
    await update();
  } catch {
    try {
      await rollback();
    } catch {
      setError(t('persona.rollbackError'));
    }
  }
}`;

describe('findDiscardedErrorViolations', () => {
  it('flags a binding-less catch that reports the failure', () => {
    const violations = findDiscardedErrorViolations(BARE_CATCH_REPORTS);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 4);
    assert.match(violations[0].message, /discarding the thrown error/);
  });

  it('flags a bound error that the block never uses', () => {
    assert.equal(findDiscardedErrorViolations(BOUND_BUT_UNUSED).length, 1);
  });

  it('allows a catch that surfaces the thrown message', () => {
    assert.deepEqual(findDiscardedErrorViolations(SURFACED_MESSAGE), []);
  });

  it('allows a catch that logs the thrown error', () => {
    assert.deepEqual(findDiscardedErrorViolations(LOGGED_BUT_NOT_SHOWN), []);
  });

  it('allows a silent fallback catch that reports nothing', () => {
    assert.deepEqual(findDiscardedErrorViolations(NO_REPORT), []);
  });

  it('ignores promise .catch handlers', () => {
    assert.deepEqual(findDiscardedErrorViolations(PROMISE_CATCH), []);
  });

  it('finds a discarding catch nested inside another catch', () => {
    assert.equal(findDiscardedErrorViolations(NESTED_CATCH).length, 1);
  });
});

describe('isCheckedFile', () => {
  it('checks web production sources only', () => {
    assert.equal(isCheckedFile('apps/web/app/(main)/persona/page.tsx'), true);
    assert.equal(isCheckedFile('apps/web/lib/store.ts'), true);
    assert.equal(isCheckedFile('apps/web/app/(main)/persona/__tests__/page.test.tsx'), false);
    assert.equal(isCheckedFile('apps/mcp/src/index.ts'), false);
  });
});

describe('findViolations', () => {
  it('reports the file and line of each violation', () => {
    const violations = findViolations([
      { path: 'apps/web/app/(main)/accounts/sections.tsx', text: BARE_CATCH_REPORTS },
      { path: 'apps/web/app/(main)/accounts/other.tsx', text: SURFACED_MESSAGE },
    ]);
    assert.deepEqual(violations.map(({ file, line }) => ({ file, line })), [
      { file: 'apps/web/app/(main)/accounts/sections.tsx', line: 4 },
    ]);
  });
});
