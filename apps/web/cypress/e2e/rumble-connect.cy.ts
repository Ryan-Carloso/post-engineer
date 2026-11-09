//---------------
// Rumble connect — e2e da seção Rumble na página de contas.
// Sem OAuth: formulário channel ID + access token chama /api/rumble-connect.
//---------------

describe('Rumble — conectar conta na página de contas', () => {
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
  // (CredentialConnectDialog), aberto pelo botão da seção Rumble.
  //---------------
  // The connect button reads "Conectar uma conta" while the section is empty
  // and "+ Conectar outra conta" once an account exists (accounts/page.tsx
  // picks the label from the account count).
  function openConnectDialog(accountsConnected = false): void {
    const label = accountsConnected ? '+ Conectar outra conta' : 'Conectar uma conta';
    cy.visit('/accounts');
    cy.wait(accountsConnected ? '@getAccountsRumble' : '@getAccounts');
    cy.contains('section', 'Rumble').within(() => {
      cy.contains('button', label).click();
    });
    cy.get('[role="dialog"]').should('be.visible');
  }

  it('exibe dialog de conexão Rumble com formulário quando não há contas', () => {
    openConnectDialog();

    cy.get('[data-testid="rumble-handle-input"]').should('be.visible');
    cy.get('[data-testid="rumble-password-input"]').should('be.visible');
    cy.get('[data-testid="rumble-connect-button"]').should('be.visible');
    // aviso de segurança: o token equivale à senha
    cy.contains('token de acesso').should('exist');
  });

  it('botão fica desabilitado sem channel ID ou sem token', () => {
    openConnectDialog();

    cy.get('[data-testid="rumble-connect-button"]').should('be.disabled');
    cy.get('[data-testid="rumble-handle-input"]').type('chan-1');
    cy.get('[data-testid="rumble-connect-button"]').should('be.disabled');
    cy.get('[data-testid="rumble-password-input"]').type('a'.repeat(40));
    cy.get('[data-testid="rumble-connect-button"]').should('not.be.disabled');
  });

  it('conecta com sucesso e mostra o canal conectado', () => {
    cy.intercept('POST', '/api/rumble-connect', {
      statusCode: 200,
      body: { success: true, accountId: 'row-1', channelId: 'chan-1' },
    }).as('rumbleConnect');

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: {
        authenticated: true,
        message: 'ok',
        accounts: [
          {
            recordId: 'row-1',
            providerAccountId: 'chan-1',
            accountName: 'My Channel',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
            provider: 'rumble',
          },
        ],
      },
    }).as('getAccountsRumble');

    openConnectDialog(true);

    cy.get('[data-testid="rumble-handle-input"]').type('chan-1');
    cy.get('[data-testid="rumble-password-input"]').type('a'.repeat(40));
    cy.get('[data-testid="rumble-connect-button"]').click();
    cy.wait('@rumbleConnect');

    cy.contains('My Channel').scrollIntoView().should('be.visible');
  });

  it('mostra erro quando o token é inválido, sem vazar o token', () => {
    cy.intercept('POST', '/api/rumble-connect', {
      statusCode: 400,
      body: { success: false, error: 'Rumble access token must be the 40-character token issued by Rumble (email bd@rumble.com).' },
    }).as('rumbleConnectFail');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('section', 'Rumble').within(() => {
      cy.contains('button', 'Conectar uma conta').click();
    });
    cy.get('[role="dialog"]').should('be.visible');

    cy.get('[data-testid="rumble-handle-input"]').type('chan-1');
    cy.get('[data-testid="rumble-password-input"]').type('a'.repeat(40));
    cy.get('[data-testid="rumble-connect-button"]').click();
    cy.wait('@rumbleConnectFail');

    cy.get('[data-testid="rumble-connect-error"]').should('be.visible');
    cy.get('[data-testid="rumble-password-input"]').should('have.value', '');
  });
});

export {};
