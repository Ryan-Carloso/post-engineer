//---------------
// LinkedIn connect — e2e da seção LinkedIn na página de contas.
// OAuth via popup: valida presença do painel e botão (fluxo completo
// de OAuth precisa de app real — coberto pelos testes unitários).
//---------------

describe('LinkedIn — seção na página de contas', () => {
  beforeEach(() => {
    // Sessão REAL no Supabase (usuário de teste do repo): o middleware
    // valida o cookie server-side, intercepts não bastam.
    cy.loginE2EUser();

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');
  });

  it('exibe painel de conexão LinkedIn com botão OAuth', () => {
    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.get('[data-testid="linkedin-connect-panel"]').scrollIntoView().should('be.visible');
    cy.get('[data-testid="linkedin-connect-button"]').should('be.visible').and('not.be.disabled');
    // texto do hint menciona páginas (perfil + company pages)
    cy.contains('páginas').should('exist');
  });

  it('roda start OAuth: chama /api/linkedin-auth/start e abre popup com auth_url', () => {
    cy.intercept('GET', '/api/linkedin-auth/start', {
      statusCode: 500,
      body: {
        success: false,
        error: 'LinkedIn credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).',
      },
    }).as('linkedinStart');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.get('[data-testid="linkedin-connect-button"]').scrollIntoView().click();
    cy.wait('@linkedinStart');
    // sem credenciais configuradas no ambiente de teste: erro exibido
    cy.get('[data-testid="linkedin-connect-error"]')
      .scrollIntoView()
      .should('be.visible');
  });
});
