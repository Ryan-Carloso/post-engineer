import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findViolations, isCheckedFile, isTestFile, parseImports, resolveSpecifier } from './check.mjs';

const DASHBOARD = `import { notifyIfSessionExpired } from '@/lib/session-expiry';

export async function fetchExperiments() {
  const response = await fetch('/api/experiments');
  notifyIfSessionExpired(response);
  return response.json();
}`;

const DASHBOARD_TEST = `import { describe, expect, it, vi } from 'vitest';
import { fetchExperiments } from '../experiments-dashboard';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

describe('fetchExperiments', () => {
  it('notifies the session-expiry handler on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await fetchExperiments();
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
  });
});`;

const DASHBOARD_TEST_NO_ASSERTION = `import { describe, expect, it, vi } from 'vitest';
import { fetchExperiments } from '../experiments-dashboard';

describe('fetchExperiments', () => {
  it('returns the experiment list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, experiments: [] }) })));
    await expect(fetchExperiments()).resolves.toEqual({ success: true, experiments: [] });
  });
});`;

const PAGE_WITH_PUT = `import { notifyIfSessionExpired } from '@/lib/session-expiry';

async function saveAccounts(personaId) {
  const res = await fetch('/api/persona/publishing-accounts?personaId=' + personaId, { method: 'PUT' });
  if (!res.ok) notifyIfSessionExpired(res);
}`;

const PAGE_TEST_NO_ASSERTION = `import { describe, expect, it, vi } from 'vitest';
import { PersonaPage } from '../page';

describe('PersonaPage', () => {
  it('saves the persona', async () => {
    expect(true).toBe(true);
  });
});`;

const SECTION = `import { notifyIfSessionExpired } from '@/lib/session-expiry';

export async function loadBinding(personaId) {
  const res = await fetch('/api/persona/publishing-accounts?personaId=' + personaId);
  if (!res.ok) notifyIfSessionExpired(res);
}`;

const PAGE_RENDERING_SECTION = `import { Section } from './persona-publishing-accounts-section';

export function PersonaPage() {
  return Section();
}`;

const WIZARD_TEST_REDIRECT = `import { describe, expect, it, vi } from 'vitest';
import { PersonaPage } from '../page';

describe('PersonaPage', () => {
  it('redirects to login on a 401', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/x', search: '', assign } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(loadBinding('p')).resolves.toBeUndefined();
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fx');
  });
});`;

function files(entries) {
  return entries.map(([path, text]) => ({ path, text }));
}

describe('parseImports and resolveSpecifier', () => {
  it('resolves alias and relative imports to known files', () => {
    const known = new Set([
      'apps/web/lib/session-expiry.ts',
      'apps/web/lib/experiments/experiments-dashboard.ts',
      'apps/web/app/(main)/persona/page.tsx',
    ]);
    assert.deepEqual(parseImports(DASHBOARD), ['@/lib/session-expiry']);
    assert.equal(resolveSpecifier('apps/web/lib/experiments/experiments-dashboard.ts', '@/lib/session-expiry', known), 'apps/web/lib/session-expiry.ts');
    assert.equal(resolveSpecifier('apps/web/lib/__tests__/x.test.ts', '../experiments-dashboard', new Set(['apps/web/lib/experiments-dashboard.ts'])), 'apps/web/lib/experiments-dashboard.ts');
    assert.equal(resolveSpecifier('apps/web/lib/x.ts', 'react', known), null);
  });

  it('ignores type-only imports', () => {
    assert.deepEqual(parseImports(`import type { Foo } from './foo';\nimport { bar } from './bar';`), ['./bar']);
  });
});

describe('isCheckedFile and isTestFile', () => {
  it('separates production files from tests', () => {
    assert.equal(isCheckedFile('apps/web/lib/experiments/experiments-dashboard.ts'), true);
    assert.equal(isCheckedFile('apps/web/lib/experiments/__tests__/experiments-dashboard.test.ts'), false);
    assert.equal(isTestFile('apps/web/lib/experiments/__tests__/experiments-dashboard.test.ts'), true);
    assert.equal(isTestFile('apps/web/lib/experiments/experiments-dashboard.ts'), false);
  });
});

describe('findViolations', () => {
  it('passes a call site with a direct 401 test', () => {
    const violations = findViolations(files([
      ['apps/web/lib/experiments/experiments-dashboard.ts', DASHBOARD],
      ['apps/web/lib/experiments/__tests__/experiments-dashboard.test.ts', DASHBOARD_TEST],
    ]));
    assert.deepEqual(violations, []);
  });

  it('flags a call site whose test never asserts the 401 behavior', () => {
    const violations = findViolations(files([
      ['apps/web/lib/experiments/experiments-dashboard.ts', DASHBOARD],
      ['apps/web/lib/experiments/__tests__/experiments-dashboard.test.ts', DASHBOARD_TEST_NO_ASSERTION],
    ]));
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, 'apps/web/lib/experiments/experiments-dashboard.ts');
    assert.equal(violations[0].line, 5);
  });

  it('flags the moved PUT when the page test lost the 401 assertion', () => {
    const violations = findViolations(files([
      ['apps/web/app/(main)/persona/page.tsx', PAGE_WITH_PUT],
      ['apps/web/app/(main)/persona/__tests__/page.test.tsx', PAGE_TEST_NO_ASSERTION],
    ]));
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, 'apps/web/app/(main)/persona/page.tsx');
  });

  it('passes a call site covered transitively through the rendered page', () => {
    const violations = findViolations(files([
      ['apps/web/app/(main)/persona/persona-publishing-accounts-section.ts', SECTION],
      ['apps/web/app/(main)/persona/page.tsx', PAGE_RENDERING_SECTION],
      ['apps/web/app/(main)/persona/__tests__/page.test.tsx', WIZARD_TEST_REDIRECT],
    ]));
    assert.deepEqual(violations, []);
  });

  it('passes a test that asserts the login redirect instead of the handler', () => {
    const violations = findViolations(files([
      ['apps/web/lib/experiments/experiments-dashboard.ts', DASHBOARD],
      ['apps/web/lib/experiments/__tests__/experiments-dashboard.test.ts', WIZARD_TEST_REDIRECT.replaceAll('../page', '../experiments-dashboard').replaceAll('loadBinding', 'fetchExperiments')],
    ]));
    assert.deepEqual(violations, []);
  });

  it('does not require coverage for the session-expiry module itself', () => {
    const violations = findViolations(files([
      ['apps/web/lib/session-expiry.ts', `export function notifyIfSessionExpired(response: Response): void {\n  if (response.status !== 401) return;\n}`],
    ]));
    assert.deepEqual(violations, []);
  });
});
