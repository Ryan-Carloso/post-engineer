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

function interceptAccess(accessUntil: string, subscriptionStatus: string | null = null): void {
  cy.intercept('GET', '**/rest/v1/user_profiles?select=access_until*', {
    statusCode: 200,
    body: [{ access_until: accessUntil, subscription_status: subscriptionStatus }],
  }).as('access');
}

function visitAccount(): void {
  cy.visit('/account', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
  cy.wait('@access');
}

describe('Account access notice', () => {
  beforeEach(() => {
    cy.viewport(1280, 1000);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('shows the days left and the WhatsApp contact while the trial runs', () => {
    interceptAccess(new Date(Date.now() + 3 * DAY_MS - 60_000).toISOString());
    visitAccount();
    cy.get('[data-testid="trial-banner"]')
      .should('be.visible')
      .and('contain.text', 'Teste grátis: faltam 3 dias.')
      .and('contain.text', 'Agendar e publicar param quando ele termina.');
    cy.get('[data-testid="trial-banner"] [data-testid="access-contact-link"]')
      .should('have.attr', 'href', CONTACT_URL)
      .and('have.attr', 'target', '_blank')
      .and('contain.text', 'Fale com a gente no WhatsApp');
    cy.get('[data-testid="access-inactive-card"]').should('not.exist');
  });

  it('says it is the last day when less than a day is left', () => {
    interceptAccess(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());
    visitAccount();
    cy.get('[data-testid="trial-banner"]').should('contain.text', 'Teste grátis: último dia.');
  });

  it('replaces the banner with the WhatsApp card once the trial has ended', () => {
    interceptAccess(new Date(Date.now() - DAY_MS).toISOString());
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]')
      .should('be.visible')
      .and('have.attr', 'role', 'alert')
      .and('contain.text', 'Seu teste grátis terminou')
      .and('contain.text', 'Agendar e publicar estão pausados.');
    cy.get('[data-testid="access-inactive-card"] [data-testid="access-contact-link"]').should('have.attr', 'href', CONTACT_URL);
    cy.get('[data-testid="trial-banner"]').should('not.exist');
  });

  it('names the cancelled subscription, not the trial, when a paid account lapses', () => {
    interceptAccess(new Date(Date.now() - DAY_MS).toISOString(), 'canceled');
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]')
      .should('be.visible')
      .and('contain.text', 'Sua assinatura está inativa')
      .and('contain.text', 'a assinatura que cobria esta conta não está ativa');
    cy.get('[data-testid="access-inactive-card"]').should('not.contain.text', 'Seu teste grátis terminou');
  });

  it('shows no banner for an active paid subscription', () => {
    interceptAccess(new Date(Date.now() + 300 * DAY_MS).toISOString(), 'active');
    visitAccount();
    cy.get('[data-testid="trial-banner"]').should('not.exist');
    cy.get('[data-testid="access-inactive-card"]').should('not.exist');
  });
});

export {};
