import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '../../../test/repo-root';

describe('loginE2EUser cookie order', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../commands.ts'),
    'utf8',
  );

  it('visits the public landing page before writing the session cookie', () => {
    const visitAt = source.indexOf("cy.visit('/landing')");
    const setCookieAt = source.indexOf('cy.setCookie(');
    expect(visitAt, 'cy.visit(\'/landing\')').toBeGreaterThan(-1);
    expect(setCookieAt, 'cy.setCookie(').toBeGreaterThan(visitAt);
  });

  it('caches the session for the whole run under the e2e email', () => {
    const sessionAt = source.indexOf('cy.session(');
    const visitAt = source.indexOf("cy.visit('/landing')");
    expect(sessionAt).toBeGreaterThan(-1);
    expect(visitAt).toBeGreaterThan(sessionAt);
    expect(source).toContain("['e2e', email]");
    expect(source).toContain('cacheAcrossSpecs: true');
    expect(source).not.toContain("['e2e', email, password]");
    expect(source.match(/cy\.session\(/g)).toHaveLength(1);
    expect(source.match(/grant_type=password/g)).toHaveLength(1);
  });

  it('validates the cached cookie without another password grant', () => {
    const validateAt = source.indexOf('function validateCachedE2ESession');
    expect(validateAt).toBeGreaterThan(-1);
    const validateBody = source.slice(validateAt);
    expect(validateBody).toContain('sessionStillValid');
    expect(validateBody).not.toContain('grant_type=password');
    expect(validateBody).not.toContain('/auth/v1/token');
    expect(source).not.toContain('cy.wait(');
    expect(source).not.toContain('cy.clock(');
  });

  it('gives the retry sleep a timeout longer than its delay', () => {
    expect(source).toContain('cy.then({ timeout: retryWaitTimeoutMs(step.delayMs) }, () => sleepMs(step.delayMs))');
  });

  it('counts each password grant on stdout through the registered task', () => {
    const config = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/cypress.config.ts'), 'utf8');
    expect(source).toContain("cy.task('logE2EPasswordGrant'");
    expect(config).toContain('logE2EPasswordGrant(attempt: unknown)');
    expect(config).toContain('[e2e] supabase password grant attempt ');
  });
});
