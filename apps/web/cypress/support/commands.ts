//---------------
// Custom Cypress commands
//---------------

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
      openVoicePicker(): Chainable;
      pickHouseVoice(label: string): Chainable;
      playHouseVoiceSample(label: string): Chainable;
    }
  }
}

Cypress.Commands.add('loginE2EUser', () => {
  // One password grant per Cypress run (cy.session + cacheAcrossSpecs).
  // The id includes the e2e email so a different user never restores it.
  // validate only reads the cookie Cypress already restored — it does not
  // call /auth/v1/token. The cookie is still written after a visit to
  // /landing: a cookie set before the browser is on the app origin does
  // not attach, and /landing is public so it does not mount Supabase.
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
        // log: false — the value is a live access token.
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
          // A non-2xx must not dump the request body (it holds the password).
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
          // log: false — the body holds the access token and the refresh token.
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

// House voices live in a dialog opened from the voice card ("Escolher voz" /
// "Trocar voz", or the EN labels). Picking searches by label first so the
// row is on screen whatever the catalog size, then clicks the row; the
// dialog closes on pick.
const VOICE_PICKER_TRIGGER = /^(Escolher voz|Trocar voz|Choose voice|Change voice)$/;

Cypress.Commands.add('openVoicePicker', () => {
  cy.contains('button', VOICE_PICKER_TRIGGER).scrollIntoView().click();
  return cy.get('[role="dialog"]').should('be.visible');
});

Cypress.Commands.add('pickHouseVoice', (label: string) => {
  cy.openVoicePicker();
  cy.get('[role="dialog"] input[type="search"]').type(label);
  cy.get('[role="dialog"]').contains('button[aria-pressed]', label).click();
  return cy.get('[role="dialog"]').should('not.exist');
});

Cypress.Commands.add('playHouseVoiceSample', (label: string) => {
  cy.get('body').then(($body) => {
    if ($body.find('[role="dialog"]').length === 0) {
      cy.openVoicePicker();
    }
  });
  return cy.get('[role="dialog"]').contains('li', label).find('button').first().click();
});

function requiredCypressEnv(key: string, name: string): string {
  const value: unknown = Cypress.env(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is not defined`);
  }
  return value;
}

export {};
