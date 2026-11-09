//---------------
// 3Speak connect — e2e da seção 3Speak na página de contas.
// Sem OAuth: formulário usuário Hive + posting key chama /api/threespeak-connect.
//---------------

describe('3Speak — conectar conta na página de contas', () => {
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
  // (KeyConnectDialog), aberto pelo botão da seção 3Speak.
  //---------------
  // The connect button reads "Conectar uma conta" while the section is empty
  // and "+ Conectar outra conta" once an account exists (accounts/page.tsx
  // picks the label from the account count).
  function openConnectDialog(accountsConnected = false): void {
    const label = accountsConnected ? '+ Conectar outra conta' : 'Conectar uma conta';
    cy.visit('/accounts');
    cy.wait(accountsConnected ? '@getAccountsThreespeak' : '@getAccounts');
    cy.contains('section', '3Speak').within(() => {
      cy.contains('button', label).click();
    });
    cy.get('[role="dialog"]').should('be.visible');
  }

  it('exibe dialog de conexão 3Speak com formulário quando não há contas', () => {
    openConnectDialog();

    cy.get('[data-testid="threespeak-handle-input"]').should('be.visible');
    cy.get('[data-testid="threespeak-password-input"]').should('be.visible');
    cy.get('[data-testid="threespeak-connect-button"]').should('be.visible');
    // aviso de segurança: só a posting key, nunca owner/active/master
    cy.contains('posting key').should('exist');
  });

  it('botão fica desabilitado sem usuário ou sem posting key', () => {
    openConnectDialog();

    cy.get('[data-testid="threespeak-connect-button"]').should('be.disabled');
    cy.get('[data-testid="threespeak-handle-input"]').type('alice');
    cy.get('[data-testid="threespeak-connect-button"]').should('be.disabled');
    cy.get('[data-testid="threespeak-password-input"]').type('5K-posting-key');
    cy.get('[data-testid="threespeak-connect-button"]').should('not.be.disabled');
  });

  it('conecta com sucesso e mostra o usuário conectado', () => {
    cy.intercept('POST', '/api/threespeak-connect', {
      statusCode: 200,
      body: { success: true, accountId: 'row-1', username: 'alice' },
    }).as('threespeakConnect');

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: {
        authenticated: true,
        message: 'ok',
        accounts: [
          {
            recordId: 'row-1',
            providerAccountId: 'alice',
            accountName: 'Alice',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
            provider: '3speak',
          },
        ],
      },
    }).as('getAccountsThreespeak');

    openConnectDialog(true);

    cy.get('[data-testid="threespeak-handle-input"]').type('alice');
    cy.get('[data-testid="threespeak-password-input"]').type('5K-posting-key');
    cy.get('[data-testid="threespeak-connect-button"]').click();
    cy.wait('@threespeakConnect');

    cy.contains('Alice').scrollIntoView().should('be.visible');
  });

  it('mostra erro quando a credencial é inválida, sem vazar a posting key', () => {
    cy.intercept('POST', '/api/threespeak-connect', {
      statusCode: 422,
      body: { success: false, error: 'Invalid Hive username or posting key.', code: 'THREESPEAK_CREDENTIAL_REJECTED' },
    }).as('threespeakConnectFail');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('section', '3Speak').within(() => {
      cy.contains('button', 'Conectar uma conta').click();
    });
    cy.get('[role="dialog"]').should('be.visible');

    cy.get('[data-testid="threespeak-handle-input"]').type('alice');
    cy.get('[data-testid="threespeak-password-input"]').type('5K-chave-errada');
    cy.get('[data-testid="threespeak-connect-button"]').click();
    cy.wait('@threespeakConnectFail');

    cy.get('[data-testid="threespeak-connect-error"]').should('be.visible');
    // A credencial rejeitada (422) tem mensagem própria, não o erro genérico.
    cy.get('[data-testid="threespeak-connect-error"]').should('contain', 'rejeitou');
    cy.get('[data-testid="threespeak-password-input"]').should('have.value', '');
  });
});
