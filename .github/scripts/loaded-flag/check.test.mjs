import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findLoadedFlagViolations, findViolations, isCheckedFile } from './check.mjs';

const FAILED_LOAD_SETS_FLAG = `async function load() {
  try {
    const binding = await fetchBinding(personaId);
    setDraftSelection(binding);
    setPublishingAccountsLoaded(true);
  } catch (error) {
    setLoadError(error.message);
  } finally {
    setLoading(false);
    setPublishingAccountsLoaded(true);
  }
}`;

const FAILED_LOAD_SETS_VARIABLE = `async function load() {
  let loaded = false;
  try {
    const binding = await fetchBinding(personaId);
    setDraftSelection(binding);
    loaded = true;
  } catch (error) {
    setLoadError(error.message);
  } finally {
    setLoading(false);
    setPublishingAccountsLoaded(loaded);
  }
}`;

const SUCCESS_PATH_SETS_FLAG = `async function load() {
  try {
    const binding = await fetchBinding(personaId);
    setDraftSelection(binding);
    setPublishingAccountsLoaded(true);
  } catch (error) {
    setLoadError(error.message);
  } finally {
    setLoading(false);
  }
}`;

const FINALLY_CLEARS_LOADING = `async function save() {
  setLoading(true);
  try {
    await putAccounts();
  } finally {
    setLoading(false);
  }
}`;

const FLAG_IN_COMMENT_AND_STRING = `async function load() {
  try {
    await fetchBinding(personaId);
  } catch (error) {
    setLoadError(error.message);
  } finally {
    setLoading(false);
  }
}
// setPublishingAccountsLoaded(true) in a finally block is the bug
const hint = 'setPublishingAccountsLoaded(true)';`;

const NESTED_FINALLY = `async function load() {
  try {
    await fetchBinding(personaId);
  } catch (error) {
    setLoadError(error.message);
  } finally {
    try {
      await cleanup();
    } finally {
      setPublishingAccountsLoaded(true);
    }
  }
}`;

describe('findLoadedFlagViolations', () => {
  it('flags a literal true loaded flag inside finally', () => {
    const violations = findLoadedFlagViolations(FAILED_LOAD_SETS_FLAG);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 10);
    assert.match(violations[0].message, /finally/);
  });

  it('flags the inner finally only when it is nested inside another finally', () => {
    const violations = findLoadedFlagViolations(NESTED_FINALLY);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 10);
  });

  it('allows a variable loaded flag inside finally', () => {
    assert.deepEqual(findLoadedFlagViolations(FAILED_LOAD_SETS_VARIABLE), []);
  });

  it('allows a literal true loaded flag on the success path only', () => {
    assert.deepEqual(findLoadedFlagViolations(SUCCESS_PATH_SETS_FLAG), []);
  });

  it('allows unrelated setters inside finally', () => {
    assert.deepEqual(findLoadedFlagViolations(FINALLY_CLEARS_LOADING), []);
  });

  it('ignores the pattern inside comments and strings', () => {
    assert.deepEqual(findLoadedFlagViolations(FLAG_IN_COMMENT_AND_STRING), []);
  });
});

describe('isCheckedFile', () => {
  it('checks web production sources only', () => {
    assert.equal(isCheckedFile('apps/web/app/(main)/persona/page.tsx'), true);
    assert.equal(isCheckedFile('apps/web/lib/store.ts'), true);
    assert.equal(isCheckedFile('apps/web/app/(main)/persona/__tests__/page.test.tsx'), false);
    assert.equal(isCheckedFile('apps/web/app/(main)/persona/page.test.tsx'), false);
    assert.equal(isCheckedFile('apps/mcp/src/index.ts'), false);
    assert.equal(isCheckedFile('apps/web/lib/schema.gen.ts'), false);
  });
});

describe('findViolations', () => {
  it('reports the file and line of each violation', () => {
    const violations = findViolations([
      { path: 'apps/web/app/(main)/persona/section.tsx', text: FAILED_LOAD_SETS_FLAG },
      { path: 'apps/web/app/(main)/persona/other.tsx', text: SUCCESS_PATH_SETS_FLAG },
      { path: 'apps/web/app/(main)/persona/__tests__/section.test.tsx', text: FAILED_LOAD_SETS_FLAG },
    ]);
    assert.deepEqual(violations.map(({ file, line }) => ({ file, line })), [
      { file: 'apps/web/app/(main)/persona/section.tsx', line: 10 },
    ]);
  });
});
