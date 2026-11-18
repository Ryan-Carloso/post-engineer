describe('LinkedIn — accounts page section', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');
  });

  function visitAccountsLinkedInSection(): void {
    cy.visit('/accounts');
    cy.contains('section', 'LinkedIn', { timeout: 10_000 })
      .scrollIntoView()
      .should('be.visible');
  }

  it('shows the LinkedIn section with the OAuth connect button', () => {
    visitAccountsLinkedInSection();

    cy.contains('section', 'LinkedIn').within(() => {
      cy.contains('páginas').should('exist');
      cy.get('button[aria-label="Conectar uma conta"]')
        .scrollIntoView()
        .should('be.visible')
        .and('not.be.disabled');
    });
  });

  it('start OAuth calls /api/linkedin-auth/start and surfaces missing-credentials error', () => {
    cy.intercept('GET', '/api/linkedin-auth/start', {
      statusCode: 500,
      body: {
        success: false,
        error: 'LinkedIn credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).',
      },
    }).as('linkedinStart');

    visitAccountsLinkedInSection();

    cy.contains('section', 'LinkedIn').within(() => {
      cy.get('button[aria-label="Conectar uma conta"]').scrollIntoView().click();
    });
    cy.wait('@linkedinStart');
    cy.contains('section', 'LinkedIn').within(() => {
      cy.contains('LinkedIn credentials are not configured').should('be.visible');
    });
  });
});

export {};
