const COMPARISON = {
  success: true,
  window: '7d',
  truncated: false,
  accounts: [
    {
      provider: 'youtube',
      accountId: 'yt-1',
      videos: 12,
      baselineViews: 900,
      prompts: [
        {
          versionId: '11111111-1111-4111-8111-111111111111',
          slug: 'calm-hook',
          title: 'Calm hook',
          version: 2,
          source: 'user',
          videos: 6,
          medianViews: 1500,
          lift: 1.5,
          pValue: 0.03,
          label: 'clear',
          direction: 'above',
        },
        {
          versionId: '22222222-2222-4222-8222-222222222222',
          slug: 'story-first-reels',
          title: 'Story first',
          version: 1,
          source: 'official',
          videos: 6,
          medianViews: 600,
          lift: 0.7,
          pValue: 0.2,
          label: 'no_signal',
          direction: 'below',
        },
      ],
    },
  ],
};

function interceptShell(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  });
  cy.intercept('GET', '/api/billing/tokens', { statusCode: 200, body: { success: true, balance: 100 } });
  cy.intercept('GET', '/api/schedule', { statusCode: 200, body: { success: true, schedules: [] } });
  cy.intercept('GET', '/api/schedule/status**', { statusCode: 200, body: { success: true, upcoming: [], recent: [] } });
  cy.intercept('GET', '/api/persona/video-generations**', { statusCode: 200, body: { success: true, generations: [] } });
}

describe('experiments page (prompt comparison)', () => {
  beforeEach(() => {
    cy.viewport(1280, 1100);
    cy.loginE2EUser();
    interceptShell();
  });

  it('shows each prompt of the account with its lift and label', () => {
    cy.intercept('GET', '/api/experiments?window=7d', { statusCode: 200, body: COMPARISON }).as('getComparison');
    cy.visit('/experiments');
    cy.wait('@getComparison');

    cy.contains('h1', 'Experimentos').should('be.visible');
    cy.contains('Calm hook').should('be.visible');
    cy.contains('Story first').should('be.visible');
    cy.contains('Oficial').should('be.visible');
    cy.contains('Claro').should('be.visible');
    cy.contains('Sem diferença ainda').should('be.visible');
    cy.contains('1,5×').should('be.visible');
    cy.contains('12 vídeos · mediana de 900 views').should('be.visible');
  });

  it('switches the window to 28d', () => {
    cy.intercept('GET', '/api/experiments?window=7d', { statusCode: 200, body: COMPARISON }).as('getComparison');
    cy.intercept('GET', '/api/experiments?window=28d', { statusCode: 200, body: { ...COMPARISON, window: '28d' } }).as('get28d');
    cy.visit('/experiments');
    cy.wait('@getComparison');

    cy.contains('[role="tab"]', '28d').click();
    cy.wait('@get28d');
    cy.contains('[role="tab"]', '28d').should('have.attr', 'data-state', 'active');
  });

  it('shows the empty state when no video names a prompt', () => {
    cy.intercept('GET', '/api/experiments?window=7d', { statusCode: 200, body: { ...COMPARISON, accounts: [] } }).as('getComparison');
    cy.visit('/experiments');
    cy.wait('@getComparison');

    cy.contains('Nenhum experimento ainda').should('be.visible');
  });

  it('shows the error state with a retry when the read fails', () => {
    cy.intercept('GET', '/api/experiments?window=7d', { statusCode: 500, body: { success: false, error: 'down' } }).as('getComparison');
    cy.visit('/experiments');
    cy.wait('@getComparison');

    cy.contains('Não foi possível carregar os experimentos').should('be.visible');
    cy.contains('button', 'Tentar de novo').should('be.visible');
  });
});

export {};
