import {
  decodeSupabaseSessionCookie,
  encodeSupabaseSessionCookie,
  isPasswordGrantSession,
  passwordGrantErrorCode,
  passwordGrantStep,
  retryWaitTimeoutMs,
  sessionStillValid,
  singleHeader,
  supabaseAuthCookieName,
} from './password-grant';

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
  const cookieName = supabaseAuthCookieName(supabaseUrl);

  return cy.session(
    ['e2e', email],
    () => {
      obtainPasswordGrant({ supabaseUrl, anonKey, email, password }).then((session) => {
        const encoded = encodeSupabaseSessionCookie(session);
        cy.visit('/landing');
        cy.setCookie(cookieName, encoded, { log: false });
        cy.getCookie(cookieName, { log: false }).should('exist');
      });
    },
    {
      cacheAcrossSpecs: true,
      validate() {
        validateCachedE2ESession(cookieName);
      },
    },
  );
});

function obtainPasswordGrant(input: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}): Cypress.Chainable<Record<string, unknown>> {
  const attempt = (n: number): Cypress.Chainable<Record<string, unknown>> => {
    return cy.task('logE2EPasswordGrant', n).then((): Cypress.Chainable<Record<string, unknown>> => {
      return cy
        .request({
          method: 'POST',
          url: `${input.supabaseUrl}/auth/v1/token?grant_type=password`,
          headers: { apikey: input.anonKey },
          body: { email: input.email, password: input.password },
          failOnStatusCode: false,
          log: false,
        })
        .then((response): Cypress.Chainable<Record<string, unknown>> => {
          const step = passwordGrantStep({
            status: response.status,
            attempt: n,
            retryAfter: singleHeader(response.headers['retry-after']),
            nowMs: Date.now(),
            errorCode: passwordGrantErrorCode(response.body),
          });
          if (step.action === 'retry') {
            return cy.then({ timeout: retryWaitTimeoutMs(step.delayMs) }, () => sleepMs(step.delayMs)).then(() => attempt(n + 1));
          }
          if (step.action === 'fail') {
            throw new Error(step.message);
          }
          if (!isPasswordGrantSession(response.body)) {
            throw new Error('Supabase password grant returned HTTP 200 without an access_token');
          }
          return cy.wrap(response.body, { log: false });
        });
    });
  };
  return attempt(1);
}

function validateCachedE2ESession(cookieName: string): void {
  cy.getCookie(cookieName, { log: false }).should((cookie) => {
    if (cookie === null || cookie.value.length === 0) {
      throw new Error('E2E session cookie is missing');
    }
    let session: unknown;
    try {
      session = decodeSupabaseSessionCookie(cookie.value);
    } catch {
      throw new Error('E2E session cookie is not a Supabase session');
    }
    if (!sessionStillValid(session, Date.now())) {
      throw new Error('E2E session cookie is expired');
    }
  });
}

function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function requiredCypressEnv(key: string, name: string): string {
  const value: unknown = Cypress.env(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is not defined`);
  }
  return value;
}

export {};
