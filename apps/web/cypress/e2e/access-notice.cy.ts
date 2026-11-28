const CONTACT_URL = 'https://wa.me/351962248268';
const DISCORD_URL = 'https://discord.gg/ukmCXMCDJ';
const GITHUB_URL = 'https://github.com/Ryan-Carloso/post-engineer';
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

  it('shows the Discord request card, with WhatsApp and GitHub, to an account awaiting the beta', () => {
    interceptAccess(new Date(Date.now() - 60_000).toISOString());
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]')
      .should('be.visible')
      .and('have.attr', 'role', 'alert')
      .and('contain.text', 'Você ainda não está no beta')
      .and('contain.text', 'Agendar e publicar ficam pausados');
    cy.get('[data-testid="access-inactive-card"] [data-testid="access-discord-link"]')
      .should('have.attr', 'href', DISCORD_URL)
      .and('contain.text', 'Pedir acesso no Discord');
    cy.get('[data-testid="access-inactive-card"] [data-testid="access-contact-link"]').should('have.attr', 'href').and('include', CONTACT_URL);
    cy.get('[data-testid="access-inactive-card"] [data-testid="access-github-link"]').should('have.attr', 'href', GITHUB_URL);
  });

  it('shows the same request card when a beta admission was revoked', () => {
    interceptAccess(new Date(Date.now() - DAY_MS).toISOString(), 'beta');
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]').should('contain.text', 'Você ainda não está no beta');
  });

  it('shows no notice for an admitted beta account', () => {
    interceptAccess('2099-01-01T00:00:00.000Z', 'beta');
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]').should('not.exist');
  });

  it('names the cancelled subscription, not the beta, when a paid account lapses', () => {
    interceptAccess(new Date(Date.now() - DAY_MS).toISOString(), 'canceled');
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]')
      .should('be.visible')
      .and('contain.text', 'Sua assinatura está inativa')
      .and('contain.text', 'a assinatura que cobria esta conta não está ativa');
    cy.get('[data-testid="access-inactive-card"]').should('not.contain.text', 'Você ainda não está no beta');
  });

  it('shows no notice for an active paid subscription', () => {
    interceptAccess(new Date(Date.now() + 300 * DAY_MS).toISOString(), 'active');
    visitAccount();
    cy.get('[data-testid="access-inactive-card"]').should('not.exist');
  });
});

export {};
