const UNKNOWN_PATHS = ['/some-unknown', '/landing-v2'];

const SIGNED_OUT_HREFS = ['/login', '/api-documentation.txt', '/landing'];
const SIGNED_IN_HREFS = ['/', '/api-documentation.txt', '/landing'];

function expectHttp404(path: string): void {
  cy.request({ url: path, failOnStatusCode: false }).its('status').should('eq', 404);
}

function expectNotFoundLinks(hrefs: string[]): void {
  cy.contains('h1', 'Página não encontrada')
    .should('be.visible')
    .parent()
    .find('a')
    .should('have.length', hrefs.length)
    .then(($links) => {
      expect($links.toArray().map((link) => link.getAttribute('href'))).to.deep.equal(hrefs);
    });
}

function interceptShellData(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  });
  cy.intercept('GET', '/api/billing/tokens', {
    statusCode: 200,
    body: { success: true, balance: 100 },
  });
  cy.intercept('GET', '/api/schedule', {
    statusCode: 200,
    body: { success: true, schedules: [] },
  });
  cy.intercept('GET', '/api/schedule/status**', {
    statusCode: 200,
    body: { success: true, upcoming: [], recent: [] },
  });
  cy.intercept('GET', '/api/persona/video-generations**', {
    statusCode: 200,
    body: { success: true, generations: [] },
  });
}

describe('404 page — signed out', () => {
  beforeEach(() => {
    cy.clearCookies();
  });

  UNKNOWN_PATHS.forEach((path) => {
    it(`answers ${path} with HTTP 404 and the sign-up, docs and landing links`, () => {
      expectHttp404(path);

      cy.visit(path, { failOnStatusCode: false });

      cy.url().should('include', path);
      expectNotFoundLinks(SIGNED_OUT_HREFS);
    });
  });
});

describe('404 page — signed in', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    interceptShellData();
  });

  UNKNOWN_PATHS.forEach((path) => {
    it(`answers ${path} with HTTP 404 and the dashboard, docs and landing links`, () => {
      expectHttp404(path);

      cy.visit(path, { failOnStatusCode: false });

      cy.url().should('include', path);
      expectNotFoundLinks(SIGNED_IN_HREFS);
    });
  });
});

export {};
