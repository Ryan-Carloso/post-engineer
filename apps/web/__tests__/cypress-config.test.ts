import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../test/repo-root';

//---------------
// Pins the Cypress CI retry policy (issue #199): intermittent app-side
// failures hit a different spec on every CI run, so `cypress run` re-runs a
// failed test up to twice while `cypress open` never retries.
//---------------
describe('cypress.config.ts retries', () => {
  const source = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/cypress.config.ts'), 'utf8');

  it('retries failed tests twice in run mode (CI)', () => {
    expect(source).toContain('retries: { runMode: 2, openMode: 0 }');
  });

  it('never retries in interactive open mode, so local failures stay visible', () => {
    expect(source).toContain('openMode: 0');
    expect(source).not.toMatch(/openMode:\s*[1-9]/);
  });
});
