//---------------
// Custom Cypress commands
//---------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      loginE2EUser(): Chainable;
    }
  }
}

Cypress.Commands.add('loginE2EUser', () => {
  // The session cookie has to be written after the browser is already on
  // the app origin. Writing it before any visit does not attach it to
  // that host, so the next document request has no session and middleware
  // sends it to /landing (the page never mounts, and cy.wait reports
  // "No request ever occurred"). /landing is public and does not mount
  // the Supabase client, so a previous test's still-open document — which
  // can clear cookies after this command starts — is gone before the write.
  const supabaseUrl = requiredCypressEnv('supabaseUrl', 'CYPRESS_SUPABASE_URL');
  const anonKey = requiredCypressEnv('supabaseAnonKey', 'CYPRESS_SUPABASE_ANON_KEY');
  const email = requiredCypressEnv('e2eTestEmail', 'CYPRESS_E2E_TEST_EMAIL');
  const password = requiredCypressEnv('e2eTestPassword', 'CYPRESS_E2E_TEST_PASSWORD');
  return cy
      .request({
        method: 'POST',
        url: `${supabaseUrl}/auth/v1/token?grant_type=password`,
        headers: { apikey: anonKey },
        body: { email, password },
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        const session = response.body as Record<string, unknown>;
        const ref = new URL(supabaseUrl).hostname.split('.')[0];
        const encoded = window
          .btoa(JSON.stringify(session))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const cookieName = `sb-${ref}-auth-token`;
        cy.visit('/landing');
        // log: false — the value is a live access token.
        cy.setCookie(cookieName, `base64-${encoded}`, { log: false });
        cy.getCookie(cookieName, { log: false }).should('exist');
      });
});

function requiredCypressEnv(key: string, name: string): string {
  const value: unknown = Cypress.env(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is not defined`);
  }
  return value;
}

export {};
