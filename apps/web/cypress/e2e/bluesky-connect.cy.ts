//---------------
// Bluesky connect — e2e da seção Bluesky na página de contas.
// Sem OAuth: formulário handle + app password chama /api/bluesky-connect.
//---------------

describe('Bluesky — conectar conta na página de contas', () => {
  beforeEach(() => {
    // Sessão REAL no Supabase (usuário de teste do repo): o middleware
    // valida o cookie server-side, intercepts não bastam.
    cy.loginE2EUser();

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');
  });

  //---------------
  // openConnectDialog — o formulário de conexão vive num dialog agora
  // (BlueskyConnectDialog), aberto pelo botão da seção Bluesky.
  //---------------
  // The connect button reads "Conectar uma conta" while the section is empty
  // and "+ Conectar outra conta" once an account exists (accounts/page.tsx
  // picks the label from the account count).
  function openConnectDialog(accountsConnected = false): void {
    const label = accountsConnected ? '+ Conectar outra conta' : 'Conectar uma conta';
    cy.visit('/accounts');
    cy.wait(accountsConnected ? '@getAccountsBluesky' : '@getAccounts');
    cy.contains('section', 'Bluesky').within(() => {
      cy.contains('button', label).click();
    });
    cy.get('[role="dialog"]').should('be.visible');
  }

  it('exibe dialog de conexão Bluesky com formulário quando não há contas', () => {
    openConnectDialog();

    cy.get('[data-testid="bluesky-handle-input"]').should('be.visible');
    cy.get('[data-testid="bluesky-password-input"]').should('be.visible');
    cy.get('[data-testid="bluesky-connect-button"]').should('be.visible');
    // aviso de segurança: app password equivale à senha
    cy.contains('app password').should('exist');
  });

  it('botão fica desabilitado sem handle ou sem password', () => {
    openConnectDialog();

    cy.get('[data-testid="bluesky-connect-button"]').should('be.disabled');
    cy.get('[data-testid="bluesky-handle-input"]').type('eu.bsky.social');
    cy.get('[data-testid="bluesky-connect-button"]').should('be.disabled');
    cy.get('[data-testid="bluesky-password-input"]').type('xxxx-xxxx-xxxx-xxxx');
    cy.get('[data-testid="bluesky-connect-button"]').should('not.be.disabled');
  });

  it('conecta com sucesso e mostra o handle conectado', () => {
    cy.intercept('POST', '/api/bluesky-connect', {
      statusCode: 200,
      body: { success: true, accountId: 'row-1', did: 'did:plc:abc' },
    }).as('blueskyConnect');

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: {
        authenticated: true,
        message: 'ok',
        accounts: [
          {
            recordId: 'row-1',
            did: 'did:plc:abc',
            handle: 'eu.bsky.social',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
            provider: 'bluesky',
          },
        ],
      },
    }).as('getAccountsBluesky');

    openConnectDialog(true);

    cy.get('[data-testid="bluesky-handle-input"]').type('eu.bsky.social');
    cy.get('[data-testid="bluesky-password-input"]').type('app-pass-1');
    cy.get('[data-testid="bluesky-connect-button"]').click();
    cy.wait('@blueskyConnect');

    cy.contains('eu.bsky.social').scrollIntoView().should('be.visible');
  });

  it('mostra erro quando a credencial é inválida, sem vazar a senha', () => {
    cy.intercept('POST', '/api/bluesky-connect', {
      statusCode: 401,
      body: { success: false, error: 'Invalid Bluesky handle or app password.' },
    }).as('blueskyConnectFail');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('section', 'Bluesky').within(() => {
      cy.contains('button', 'Conectar uma conta').click();
    });
    cy.get('[role="dialog"]').should('be.visible');

    cy.get('[data-testid="bluesky-handle-input"]').type('errado.bsky.social');
    cy.get('[data-testid="bluesky-password-input"]').type('senha-errada');
    cy.get('[data-testid="bluesky-connect-button"]').click();
    cy.wait('@blueskyConnectFail');

    cy.get('[data-testid="bluesky-connect-error"]').should('be.visible');
    cy.get('[data-testid="bluesky-password-input"]').should('have.value', '');
  });
});
