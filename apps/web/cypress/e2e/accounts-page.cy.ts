//---------------
// Accounts — UI tests para a página /accounts.
  // Testa o fluxo único de conexão, listas de contas e OAuth.
//---------------

describe('Accounts — UI', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('getSession');

    cy.intercept('GET', '/api/health', {
      statusCode: 200,
      body: { status: 'ok' },
    }).as('getHealth');
  });

  it('renderiza o mesmo slot de conexão para todas as redes', () => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Contas').should('be.visible');
    cy.get('button[aria-label="Conectar uma conta"]').should('have.length', 4);
  });

  it('renderiza lista de contas conectadas com botão + Conectar outra', () => {
    const accounts = [
      {
        recordId: 'acc-yt-1',
        channelId: 'ch-alpha',
        channelName: 'Canal Alpha',
        email: 'alpha@example.com',
        connectedAt: 1_700_000_000_000,
        lastUsed: 1_700_000_000_000,
        provider: 'youtube',
      },
      {
        recordId: 'acc-ig-1',
        igUserId: 'ig-456',
        username: 'meu.perfil',
        connectedAt: 1_700_000_000_000,
        lastUsed: 1_700_000_000_000,
        provider: 'instagram',
      },
    ];

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts, message: 'ok' },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('Canal Alpha').should('be.visible');
    cy.contains('@meu.perfil').should('be.visible');
    cy.contains('button', '+ Conectar outra conta').should('be.visible');
  });

  it('mostra a inicial quando o thumbnail da conta retorna 403', () => {
    const accounts = [
      {
        recordId: 'acc-yt-403',
        channelId: 'ch-403',
        channelName: 'Canal Bloqueado',
        thumbnail: 'https://yt3.ggpht.com/avatar.jpg',
        connectedAt: 1_700_000_000_000,
        lastUsed: 1_700_000_000_000,
        provider: 'youtube',
      },
    ];

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts, message: 'ok' },
    }).as('getAccounts');
    cy.intercept('GET', '**/_next/image*', { statusCode: 403, body: '' }).as('blockedThumbnail');

    cy.visit('/accounts');
    cy.wait('@getAccounts');
    cy.wait('@blockedThumbnail');

    cy.get('[data-testid=account-card] [role="img"]')
      .should('have.attr', 'aria-label', 'Canal Bloqueado')
      .should('contain.text', 'C');
  });

  it('exibe erro quando o start do OAuth do YouTube falha', () => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    // Start do OAuth falha no servidor
    cy.intercept('GET', '/api/google-oauth/start', {
      statusCode: 500,
      body: { success: false },
    }).as('googleStart');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('button', 'Conectar uma conta').first().click();
    cy.contains('Não foi possível iniciar o OAuth.').should('be.visible');
  });

  it('abre o formulário Bluesky em um dialog e conecta a conta', () => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');
    cy.intercept('POST', '/api/bluesky-connect', {
      statusCode: 200,
      body: { success: true },
    }).as('connectBluesky');

    cy.visit('/accounts');
    cy.wait('@getAccounts');
    cy.get('button[aria-label="Conectar uma conta"]').eq(2).click();
    cy.get('[role=dialog]').should('be.visible');
    cy.get('[data-testid=bluesky-handle-input]').type('meu.bsky.social');
    cy.get('[data-testid=bluesky-password-input]').type('xxxx-xxxx-xxxx');
    cy.get('[data-testid=bluesky-connect-button]').click();
    cy.wait('@connectBluesky');
    cy.get('[role=dialog]').should('not.exist');
  });

  it('seleciona e desmarca uma conta clicando no card (checkbox)', () => {
    const accounts = [
      {
        recordId: 'acc-yt-1',
        channelId: 'ch-alpha',
        channelName: 'Canal Alpha',
        email: 'alpha@example.com',
        connectedAt: 1_700_000_000_000,
        lastUsed: 1_700_000_000_000,
        provider: 'youtube',
      },
    ];

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts, message: 'ok' },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.get('[data-testid=account-card]').should('have.length', 1);
    cy.get('[data-testid=account-card-select]').should('not.be.checked');

    // Seleciona
    cy.get('[data-testid=account-card]').click();
    cy.get('[data-testid=account-card-select]').should('be.checked');

    // Desmarca
    cy.get('[data-testid=account-card]').click();
    cy.get('[data-testid=account-card-select]').should('not.be.checked');
  });

  it('mostra as contas sem uma ação de remoção que só recarrega a lista', () => {
    const accounts = [
      {
        recordId: 'acc-yt-1',
        channelId: 'ch-alpha',
        channelName: 'Canal Alpha',
        email: 'alpha@example.com',
        connectedAt: 1_700_000_000_000,
        lastUsed: 1_700_000_000_000,
        provider: 'youtube',
      },
      {
        recordId: 'acc-ig-1',
        igUserId: 'ig-456',
        username: 'meu.perfil',
        connectedAt: 1_700_000_000_000,
        lastUsed: 1_700_000_000_000,
        provider: 'instagram',
      },
    ];

    cy.intercept('GET', '/api/account', (req) => {
      req.reply({
        statusCode: 200,
        body: { authenticated: true, accounts, message: 'ok' },
      });
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('Canal Alpha').should('be.visible');
    cy.contains('@meu.perfil').should('be.visible');
    cy.get('[data-testid=account-card-remove]').should('not.exist');
  });

  it('mantém os painéis utilizáveis sem rolagem horizontal no celular', () => {
    cy.viewport(390, 844);
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Contas').should('be.visible');
    cy.get('button[aria-label="Conectar uma conta"]').first().scrollIntoView().should('be.visible');
    cy.window().then((browserWindow) => {
      expect(browserWindow.document.documentElement.scrollWidth).to.be.at.most(browserWindow.innerWidth);
    });
  });
});
