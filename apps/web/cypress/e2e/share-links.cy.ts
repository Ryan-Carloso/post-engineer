const LINK_ID = '33333333-3333-4333-8333-333333333333';
const PERSONA_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'a'.repeat(43);

interface LinkRow {
  id: string;
  personaIds: string[] | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastViewedAt: string | null;
}

function link(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: LINK_ID,
    personaIds: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastViewedAt: null,
    ...overrides,
  };
}

function interceptShellData(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  });
  cy.intercept('GET', '/api/billing/tokens', { statusCode: 200, body: { success: true, balance: 100 } });
  cy.intercept('GET', '/api/schedule', { statusCode: 200, body: { success: true, schedules: [] } });
  cy.intercept('GET', '/api/schedule/status**', { statusCode: 200, body: { success: true, upcoming: [], recent: [] } });
  cy.intercept('GET', '/api/persona/list', {
    statusCode: 200,
    body: { authenticated: true, personas: [{ id: PERSONA_ID, name: 'Maria' }] },
  });
}

function visitAccount(): void {
  cy.visit('/account', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
      Object.defineProperty(win.navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      });
    },
  });
}

describe('Account — public share links', () => {
  beforeEach(() => {
    cy.viewport(1280, 1400);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('shows the empty state, creates a scoped link once and copies it', () => {
    cy.intercept('GET', '/api/share-links', { statusCode: 200, body: { success: true, links: [] } }).as('list');
    cy.intercept('POST', '/api/share-links', {
      statusCode: 201,
      body: {
        success: true,
        id: LINK_ID,
        token: TOKEN,
        path: `/s/${TOKEN}`,
        url: `https://post-engineer.com/s/${TOKEN}`,
        personaIds: [PERSONA_ID],
        createdAt: '2026-11-22T00:00:00.000Z',
        expiresAt: null,
      },
    }).as('create');
    visitAccount();

    cy.get('[data-testid=share-links-empty-state]').should('be.visible');
    cy.get('[data-testid=share-link-persona]').select('Maria');
    cy.get('[data-testid=create-share-link-btn]').click();
    cy.wait('@create').its('request.body').should('deep.equal', { personaIds: [PERSONA_ID] });
    cy.get('[data-testid=share-link-url]').should('have.value', `${Cypress.config('baseUrl')}/s/${TOKEN}`);
    cy.get('[data-testid=copy-share-link-btn]').click();
    cy.get('[data-testid=copy-share-link-btn]').should('contain', 'Copiado');
  });

  it('lists links by status and revokes an active one after confirming', () => {
    let revoked = false;
    cy.intercept('GET', '/api/share-links', (request) => {
      request.reply({
        statusCode: 200,
        body: {
          success: true,
          links: [
            link({ revokedAt: revoked ? '2026-11-21T00:00:00.000Z' : null, lastViewedAt: '2026-11-21T10:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', personaIds: [PERSONA_ID] }),
            link({ id: 'expired-1', expiresAt: '2020-01-01T00:00:00.000Z' }),
          ],
        },
      });
    }).as('list');
    cy.intercept('DELETE', `/api/share-links/${LINK_ID}`, (request) => {
      revoked = true;
      request.reply({ statusCode: 200, body: { success: true, alreadyRevoked: false } });
    }).as('revoke');
    visitAccount();

    cy.get(`[data-testid=share-link-row-${LINK_ID}]`).should('contain', 'Ativo').and('contain', '1 persona(s)');
    cy.get('[data-testid=share-link-row-expired-1]').should('contain', 'Expirado');
    cy.get('[data-testid=revoke-share-link-btn-expired-1]').should('not.exist');

    cy.get(`[data-testid=revoke-share-link-btn-${LINK_ID}]`).click();
    cy.get('[data-testid=confirm-dialog-cancel]').click();
    cy.get('[data-testid=confirm-dialog]').should('not.exist');

    cy.get(`[data-testid=revoke-share-link-btn-${LINK_ID}]`).click();
    cy.get('[data-testid=confirm-dialog-confirm]').click();
    cy.wait('@revoke');
    cy.get(`[data-testid=share-link-row-${LINK_ID}]`).should('contain', 'Revogado');
    cy.get(`[data-testid=revoke-share-link-btn-${LINK_ID}]`).should('not.exist');
  });

  it('shows localized messages when creating hits the cap or fails', () => {
    cy.intercept('GET', '/api/share-links', { statusCode: 200, body: { success: true, links: [link()] } });
    cy.intercept('POST', '/api/share-links', { statusCode: 409, body: { success: false, code: 'SHARE_LINK_LIMIT' } }).as('capped');
    visitAccount();

    cy.get('[data-testid=create-share-link-btn]').click();
    cy.wait('@capped');
    cy.get('[data-testid=share-links-error]').should('contain', 'Você já tem 10 links ativos');

    cy.intercept('POST', '/api/share-links', { statusCode: 500, body: { success: false, error: 'internal' } }).as('failed');
    cy.get('[data-testid=create-share-link-btn]').click();
    cy.wait('@failed');
    cy.get('[data-testid=share-links-error]').should('contain', 'Não foi possível criar o link').and('not.contain', 'internal');
  });

  it('shows a localized message when revoking fails', () => {
    cy.intercept('GET', '/api/share-links', { statusCode: 200, body: { success: true, links: [link()] } });
    cy.intercept('DELETE', `/api/share-links/${LINK_ID}`, { statusCode: 500, body: { success: false } }).as('revoke');
    visitAccount();

    cy.get(`[data-testid=revoke-share-link-btn-${LINK_ID}]`).click();
    cy.get('[data-testid=confirm-dialog-confirm]').click();
    cy.wait('@revoke');
    cy.get('[data-testid=share-links-error]').should('contain', 'Não foi possível revogar o link');
    cy.get(`[data-testid=share-link-row-${LINK_ID}]`).should('exist');
  });

  it('shows the load error when the list cannot be fetched', () => {
    cy.intercept('GET', '/api/share-links', { statusCode: 500, body: { success: false } });
    visitAccount();

    cy.contains('Não foi possível carregar seus links').should('be.visible');
  });
});

export {};
