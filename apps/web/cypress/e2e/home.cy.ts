//---------------
// Home (Dashboard) — UI tests para a página inicial /.
// Testa renderização de hero, cards de estatísticas e ações rápidas.
//---------------

const homeAccounts = [
  {
    recordId: 'acc-yt-1',
    channelId: 'ch-alpha',
    channelName: 'Canal Alpha',
    connectedAt: 1_700_000_000_000,
    lastUsed: 1_700_000_000_000,
    provider: 'youtube',
  },
  {
    recordId: 'acc-yt-2',
    channelId: 'ch-beta',
    channelName: 'Canal Beta',
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

describe('Home (Dashboard) — UI', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: homeAccounts, message: 'ok' },
    }).as('getAccounts');

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('getSession');

    cy.intercept('GET', '/api/health', {
      statusCode: 200,
      body: { status: 'ok' },
    }).as('getHealth');
  });

  it('renderiza hero, cards de estatísticas com contagens corretas', () => {
    cy.visit('/');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Post Engineer').should('be.visible');
    cy.contains('p', 'Conecte suas contas do YouTube e Instagram').should('be.visible');

    // YouTube: 2 canais conectados
    cy.contains('2').should('be.visible');
    cy.contains('canais conectados').should('be.visible');

    // Instagram: 1 conta conectada
    cy.contains('1').should('be.visible');
    cy.contains('contas conectadas').should('be.visible');
  });

  it('navega para /accounts pela ação rápida', () => {
    cy.visit('/');
    cy.wait('@getAccounts');

    cy.contains('Conectar e gerenciar suas contas').click();
    cy.url().should('include', '/accounts');
    cy.contains('h1', 'Contas').should('be.visible');
  });

});

describe('Home (Dashboard) — Skeleton de carregamento', () => {
  it('exibe skeleton enquanto as contas carregam e o conteúdo depois', () => {
    cy.intercept('GET', '/api/account', (req) => req.reply({
      statusCode: 200,
      body: { authenticated: true, accounts: homeAccounts, message: 'ok' },
      delay: 1500,
    })).as('getAccountsDelayed');

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    });

    cy.visit('/');
    cy.get('[aria-busy="true"]').should('be.visible');
    cy.get('[aria-busy="true"] .animate-pulse').should('have.length.greaterThan', 0);

    cy.wait('@getAccountsDelayed');
    cy.get('[aria-busy="true"]').should('not.exist');
    cy.contains('h1', 'Post Engineer').should('be.visible');
  });

  it('skeleton não mostra links de ações rápidas durante o carregamento', () => {
    cy.intercept('GET', '/api/account', (req) => req.reply({
      statusCode: 200,
      body: { authenticated: true, accounts: homeAccounts, message: 'ok' },
      delay: 1500,
    })).as('getAccountsDelayed');

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    });

    cy.visit('/');
    cy.get('[aria-busy="true"]').should('be.visible');
    cy.get('[aria-busy="true"]').find('a').should('not.exist');
    cy.get('a[href="/accounts"]').should('have.length', 1);

    cy.wait('@getAccountsDelayed');
    cy.get('a[href="/accounts"]').should('have.length', 2);
  });
});