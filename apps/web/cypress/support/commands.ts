//---------------
// Comandos customizados do Cypress
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
        cy.setCookie(`sb-${ref}-auth-token`, `base64-${encoded}`);
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
