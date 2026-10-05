import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUiFile } from './ui-files.mjs';

//---------------
// UI file definition (repo-relative paths):
// apps/web/app/** and apps/web/components/** (*.ts/*.tsx),
// excluding test files (*.test.*, *.cy.*, __tests__/ dirs).
//---------------
describe('isUiFile', () => {
  it('matches page components under apps/web/app', () => {
    assert.equal(isUiFile('apps/web/app/(main)/account/page.tsx'), true);
  });

  it('matches .ts files under apps/web/app', () => {
    assert.equal(isUiFile('apps/web/app/(main)/account/helpers.ts'), true);
  });

  it('matches components under apps/web/components', () => {
    assert.equal(isUiFile('apps/web/components/ui/account-panel.tsx'), true);
  });

  it('matches API routes under app (task definition: all of app/**)', () => {
    assert.equal(isUiFile('apps/web/app/api/coverage/route.ts'), true);
  });

  it('rejects lib files', () => {
    assert.equal(isUiFile('apps/web/lib/api.ts'), false);
  });

  it('rejects files outside apps/web', () => {
    assert.equal(isUiFile('apps/mcp/src/index.ts'), false);
  });

  it('rejects non-TS files', () => {
    assert.equal(isUiFile('apps/web/app/globals.css'), false);
  });

  it('rejects *.test.* files', () => {
    assert.equal(isUiFile('apps/web/components/ui/foo.test.ts'), false);
    assert.equal(isUiFile('apps/web/app/(main)/__tests__/layout.test.tsx'), false);
  });

  it('rejects *.cy.* files', () => {
    assert.equal(isUiFile('apps/web/cypress/e2e/foo.cy.ts'), false);
    assert.equal(isUiFile('apps/web/components/ui/foo.cy.ts'), false);
  });

  it('rejects __tests__ directories', () => {
    assert.equal(isUiFile('apps/web/app/(main)/__tests__/helper.ts'), false);
  });
});
