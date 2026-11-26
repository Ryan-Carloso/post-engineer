const CONTACT_URL = 'https://wa.me/351962248268';
const DAY_MS = 24 * 60 * 60 * 1000;

function interceptShellData(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  });
  cy.intercept('GET', '/api/schedule', { statusCode: 200, body: { success: true, schedules: [] } });
  cy.intercept('GET', '/api/schedule/status**', { statusCode: 200, body: { success: true, upcoming: [], recent: [] } });
  cy.intercept('GET', '/api/persona/list', { statusCode: 200, body: { authenticated: true, personas: [] } });
  cy.intercept('GET', '/api/share-links', { statusCode: 200, body: { success: true, links: [] } });
}

function interceptTrialEndsAt(trialEndsAt: string): void {
  cy.intercept('GET', '**/rest/v1/user_profiles?select=trial_ends_at*', {
    statusCode: 200,
    body: [{ trial_ends_at: trialEndsAt }],
  }).as('trial');
}

function visitAccount(): void {
  cy.visit('/account', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
  cy.wait('@trial');
}

describe('Free trial notice', () => {
  beforeEach(() => {
    cy.viewport(1280, 1000);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('shows the days left and the WhatsApp contact while the trial runs', () => {
    interceptTrialEndsAt(new Date(Date.now() + 3 * DAY_MS - 60_000).toISOString());
    visitAccount();
    cy.get('[data-testid="trial-banner"]')
      .should('be.visible')
      .and('contain.text', 'Teste grátis: faltam 3 dias.')
      .and('contain.text', 'Agendar e publicar param quando ele termina.');
    cy.get('[data-testid="trial-banner"] [data-testid="trial-contact-link"]')
      .should('have.attr', 'href', CONTACT_URL)
      .and('have.attr', 'target', '_blank')
      .and('contain.text', 'Fale com a gente no WhatsApp');
    cy.get('[data-testid="trial-expired-card"]').should('not.exist');
  });

  it('says it is the last day when less than a day is left', () => {
    interceptTrialEndsAt(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());
    visitAccount();
    cy.get('[data-testid="trial-banner"]').should('contain.text', 'Teste grátis: último dia.');
  });

  it('replaces the banner with the WhatsApp card once the trial has ended', () => {
    interceptTrialEndsAt(new Date(Date.now() - DAY_MS).toISOString());
    visitAccount();
    cy.get('[data-testid="trial-expired-card"]')
      .should('be.visible')
      .and('have.attr', 'role', 'alert')
      .and('contain.text', 'Seu teste grátis terminou')
      .and('contain.text', 'Agendar e publicar estão pausados.');
    cy.get('[data-testid="trial-expired-card"] [data-testid="trial-contact-link"]').should('have.attr', 'href', CONTACT_URL);
    cy.get('[data-testid="trial-banner"]').should('not.exist');
  });
});

export {};
