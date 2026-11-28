describe('Accounts — UI', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('getSession');
  });

  it('renderiza o mesmo slot de conexão para todas as redes', () => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Redes conectadas').should('be.visible');
    cy.get('button[aria-label="Conectar uma conta"]').should('have.length', 11);
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

  it('lista a conta conectada e oferece apenas a ação de desconectar', () => {
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
    cy.contains('Canal Alpha').should('be.visible');

    cy.get('[data-testid=account-card-select]').should('not.exist');
    cy.get('[data-testid=youtube-disconnect-button]').should('be.visible');
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

  it('abre um popup de confirmação antes de desconectar; cancelar mantém o card', () => {
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

    cy.get('[data-testid=youtube-disconnect-button]').first().click();
    cy.get('[data-testid=confirm-dialog]').should('be.visible');
    cy.contains('[data-testid=confirm-dialog-detail]', 'Canal Alpha').should('be.visible');
    cy.get('[data-testid=confirm-dialog-cancel]').click();
    cy.get('[data-testid=confirm-dialog]').should('not.exist');
    cy.contains('Canal Alpha').should('be.visible');
  });

  it('mantém os painéis utilizáveis sem rolagem horizontal no celular', () => {
    cy.viewport(390, 844);
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Redes conectadas').should('be.visible');
    cy.get('button[aria-label="Conectar uma conta"]').first().scrollIntoView().should('be.visible');
    cy.window().then((browserWindow) => {
      expect(browserWindow.document.documentElement.scrollWidth).to.be.at.most(browserWindow.innerWidth);
    });
  });

  it('mostra LinkedIn e Threads e o erro quando a desconexão é recusada', () => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: {
        authenticated: true,
        message: 'ok',
        accounts: [
          {
            provider: 'youtube',
            recordId: 'acc-yt-1',
            channelId: 'ch-alpha',
            channelName: 'Canal Alpha',
            email: 'alpha@example.com',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
          },
          {
            provider: 'linkedin',
            recordId: 'li-member',
            providerAccountId: 'member-1',
            accountName: 'Ada Lovelace',
            accountMetadata: { kind: 'member', name: 'Ada Lovelace' },
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
          },
          {
            provider: 'linkedin',
            recordId: 'li-org',
            providerAccountId: 'urn:li:organization:9',
            accountName: 'Acme',
            accountMetadata: { kind: 'organization', name: 'Acme' },
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
          },
          {
            provider: 'threads',
            recordId: 'th-1',
            providerAccountId: '42',
            accountName: 'ana.threads',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
          },
        ],
      },
    }).as('getAccounts');
    cy.intercept('DELETE', '/api/account*', {
      statusCode: 200,
      body: { success: false },
    }).as('disconnectAccount');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('section', 'LinkedIn').scrollIntoView().within(() => {
      cy.contains('h3', 'Ada Lovelace').should('exist');
      cy.contains('Perfil').should('exist');
      cy.contains('h3', 'Acme').should('exist');
      cy.contains('Página').should('exist');
    });
    cy.contains('section', 'Threads').scrollIntoView().within(() => {
      cy.contains('h3', 'ana.threads').should('exist');
    });

    cy.get('[data-testid=youtube-disconnect-button]').scrollIntoView().click();
    cy.get('[data-testid=confirm-dialog]').should('be.visible');
    cy.get('[data-testid=confirm-dialog-confirm]').click();
    cy.wait('@disconnectAccount');
    cy.get('[data-testid=disconnect-error]')
      .should('be.visible')
      .and('contain', 'Não foi possível desconectar a conta');
  });

  it('mostra o estado de erro na conta partida: só Voltar a ligar, sem lixo', () => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: {
        authenticated: true,
        message: 'ok',
        accounts: [
          {
            provider: 'youtube',
            recordId: 'acc-yt-broken',
            channelId: 'ch-broken',
            channelName: 'Canal Partido',
            email: 'partido@example.com',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
            status: 'error',
          },
          {
            provider: 'instagram',
            recordId: 'acc-ig-ok',
            igUserId: 'ig-456',
            username: 'meu.perfil',
            connectedAt: 1_700_000_000_000,
            lastUsed: 1_700_000_000_000,
            status: 'ok',
          },
        ],
      },
    }).as('getAccounts');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('Canal Partido').should('be.visible');
    cy.contains('Token inválido').should('be.visible');
    cy.get('[data-testid=youtube-reconnect-button]').should('be.visible');
    cy.get('[data-testid=youtube-disconnect-button]').should('not.exist');
    cy.contains('1 conta com problema').should('be.visible');
    cy.get('[data-testid=instagram-disconnect-button]').should('be.visible');
  });
});
