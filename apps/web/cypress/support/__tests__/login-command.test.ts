import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// loginE2EUser is a Cypress command, so the suite cannot execute it.
// The order is the contract: a session cookie written before the browser
// is on the app origin does not attach, and a previous test's document
// can still clear cookies until it is gone. /landing is public and does
// not mount the Supabase client.
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
});
