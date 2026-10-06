import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesGlob, inCypressScope, CYPRESS_UI_SCOPE } from './cypress-scope.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('matchesGlob', () => {
  it('**/ matches zero or more directories', () => {
    assert.equal(matchesGlob('app/page.tsx', 'app/**/page.tsx'), true);
    assert.equal(matchesGlob('app/(main)/account/page.tsx', 'app/**/page.tsx'), true);
  });

  it('* does not cross directory boundaries', () => {
    assert.equal(matchesGlob('app/page.tsx', 'app/*.tsx'), true);
    assert.equal(matchesGlob('app/(main)/page.tsx', 'app/*.tsx'), false);
  });

  it('matches exact paths', () => {
    assert.equal(matchesGlob('app/providers.tsx', 'app/providers.tsx'), true);
    assert.equal(matchesGlob('app/other.tsx', 'app/providers.tsx'), false);
  });

  it('respects extensions', () => {
    assert.equal(matchesGlob('app/page.ts', 'app/**/page.tsx'), false);
    assert.equal(matchesGlob('components/ui/foo.ts', 'components/**/*.tsx'), false);
    assert.equal(matchesGlob('components/ui/foo.tsx', 'components/**/*.tsx'), true);
  });

  it('supports {a,b} alternation', () => {
    assert.equal(matchesGlob('lib/i18n/pt.ts', 'lib/i18n/**/*.{ts,tsx}'), true);
    assert.equal(matchesGlob('lib/i18n/pt.tsx', 'lib/i18n/**/*.{ts,tsx}'), true);
    assert.equal(matchesGlob('lib/i18n/pt.js', 'lib/i18n/**/*.{ts,tsx}'), false);
  });
});

describe('inCypressScope', () => {
  // Paths relative to apps/web.
  it('includes app pages and layouts', () => {
    assert.equal(inCypressScope('app/(main)/account/page.tsx'), true);
    assert.equal(inCypressScope('app/layout.tsx'), true);
  });

  it('includes the providers module', () => {
    assert.equal(inCypressScope('app/providers.tsx'), true);
  });

  it('includes tsx components', () => {
    assert.equal(inCypressScope('components/ui/account-panel.tsx'), true);
  });

  it('excludes .ts files under components (cypress scope is tsx-only there)', () => {
    assert.equal(inCypressScope('components/ui/helpers.ts'), false);
  });

  it('excludes api routes and other app files', () => {
    assert.equal(inCypressScope('app/api/coverage/route.ts'), false);
    assert.equal(inCypressScope('app/(main)/account/helpers.ts'), false);
  });

  it('excludes lib files (not UI files anyway)', () => {
    assert.equal(inCypressScope('lib/api.ts'), false);
  });
});

describe('CYPRESS_UI_SCOPE drift guard', () => {
  it('matches the UI-relevant entries of codeCoverage.include in cypress.config.ts', () => {
    const configPath = path.resolve(HERE, '..', '..', '..', 'apps', 'web', 'cypress.config.ts');
    const source = fs.readFileSync(configPath, 'utf8');
    const includeBlock = source.match(/codeCoverage:\s*{[\s\S]*?include:\s*\[([\s\S]*?)\]/);
    assert.ok(includeBlock, 'could not find codeCoverage.include in cypress.config.ts');
    const fromConfig = [...includeBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const uiRelevant = fromConfig.filter((g) => g.startsWith('app/') || g.startsWith('components/'));
    assert.deepEqual([...CYPRESS_UI_SCOPE].sort(), [...uiRelevant].sort());
  });
});
