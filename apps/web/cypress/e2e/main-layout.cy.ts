//---------------
// Main Layout — UI tests para o layout compartilhado app/(main)/layout.tsx.
// Testa sidebar: abas de navegação, aba ativa, marca e status de saúde.
//---------------

//---------------
// Auth cookie name is derived from the configured Supabase URL at runtime
// (same derivation as support/commands.ts), so these tests work against any
// Supabase project and no real project ref is hardcoded in the repo.
//---------------
function authCookieName(): string {
  const supabaseUrl = Cypress.env('supabaseUrl') as string | undefined;
  if (typeof supabaseUrl !== 'string' || supabaseUrl.length === 0) {
    throw new Error('CYPRESS_SUPABASE_URL is not defined');
  }
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

describe('Main Layout — Sidebar', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('getUser');

    // fetchSession usa supabase.auth.getSession -> POST /auth/v1/token.
    cy.intercept('POST', '**/auth/v1/token**', {
      statusCode: 200,
      body: {
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4_000_000_000,
        refresh_token: 'fake-refresh',
        user: {
          id: 'user-1',
          user_metadata: { name: 'Cypress', avatar_url: '' },
        },
      },
    }).as('getSession');

    cy.intercept('GET', '/api/health', {
      statusCode: 200,
      body: { status: 'ok' },
    }).as('getHealth');
  });

  it('renderiza marca, subtítulo e as abas de navegação', () => {
    cy.visit('/');
    cy.wait('@getHealth');

    cy.contains('Post Engineer').should('be.visible');
    cy.contains('YouTube · Instagram').should('be.visible');

    cy.contains('a', 'Início').should('be.visible');
    cy.contains('a', 'Contas').should('be.visible');
    cy.contains('a', 'Criar post').should('be.visible');
  });

  it('navega entre as páginas clicando nas abas da sidebar', () => {
    cy.visit('/');

    cy.contains('a', 'Contas').click();
    cy.url().should('include', '/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Início').click();
    cy.url().should('eq', 'http://localhost:3434/');
  });

  it('destaca a aba ativa conforme a rota atual', () => {
    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Contas')
      .should('have.attr', 'class')
      .and('contain', 'bg-white/10');

    cy.contains('a', 'Início')
      .should('have.attr', 'class')
      .and('not.contain', 'bg-white/10');
  });

  it('mostra o indicador Operacional quando a saúde do servidor está ok', () => {
    cy.visit('/');
    cy.wait('@getHealth');

    cy.contains('Operacional').should('be.visible');
  });

  it('mostra o indicador de erro quando a saúde responde status error', () => {
    cy.intercept('GET', '/api/health', {
      statusCode: 200,
      body: { status: 'error' },
    }).as('getHealthError');

    cy.visit('/');
    cy.wait('@getHealthError');

    cy.contains('Erro').should('be.visible');
  });

  it('exibe o nome do usuário autenticado no rodapé da sidebar', () => {
    // fetchSession usa supabase.auth.getSession(), que lê a sessão do
    // cookie (createBrowserClient/@supabase/ssr) sem request de rede —
    // semeamos a sessão fake direto no cookie.
    cy.setCookie(
      authCookieName(),
      JSON.stringify({
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4_000_000_000,
        refresh_token: 'fake-refresh',
        user: {
          id: 'user-1',
          user_metadata: { name: 'Cypress', avatar_url: '' },
        },
      }),
    );

    cy.visit('/');
    cy.contains('Cypress', { timeout: 10_000 }).should('be.visible');
  });

  it('permite sair da conta pelo rodapé da sidebar', () => {
    cy.setCookie(
      authCookieName(),
      JSON.stringify({
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4_000_000_000,
        refresh_token: 'fake-refresh',
        user: {
          id: 'user-1',
          user_metadata: { name: 'Cypress', avatar_url: '' },
        },
      }),
    );

    cy.visit('/');
    cy.contains('Cypress', { timeout: 10_000 }).should('be.visible');

    cy.get('button[title="Sair"]').click();
    cy.url().should('match', /\/login$/);
  });

  it('exibe fallbacks de nome quando o user_metadata não tem name', () => {
    cy.setCookie(
      authCookieName(),
      JSON.stringify({
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4_000_000_000,
        refresh_token: 'fake-refresh',
        user: {
          id: 'user-1',
          user_metadata: { user_name: 'ghuser' },
        },
      }),
    );

    cy.visit('/');
    cy.contains('ghuser', { timeout: 10_000 }).should('be.visible');
  });

  it('exibe o provider_id como último fallback de nome', () => {
    cy.setCookie(
      authCookieName(),
      JSON.stringify({
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4_000_000_000,
        refresh_token: 'fake-refresh',
        user: {
          id: 'user-1',
          user_metadata: { provider_id: 'pid123' },
        },
      }),
    );

    cy.visit('/');
    cy.contains('pid123', { timeout: 10_000 }).should('be.visible');
  });

  it('exibe nome padrão quando o user_metadata está vazio', () => {
    cy.setCookie(
      authCookieName(),
      JSON.stringify({
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4_000_000_000,
        refresh_token: 'fake-refresh',
        user: {
          id: 'user-1',
          user_metadata: {},
        },
      }),
    );

    cy.visit('/');
    cy.contains('GitHub User', { timeout: 10_000 }).should('be.visible');
  });
});
