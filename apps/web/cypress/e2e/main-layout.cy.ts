function authCookieName(): string {
  const supabaseUrl = Cypress.env('supabaseUrl') as string | undefined;
  if (typeof supabaseUrl !== 'string' || supabaseUrl.length === 0) {
    throw new Error('CYPRESS_SUPABASE_URL is not defined');
  }
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

function interceptShellData(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  }).as('getAccounts');


  cy.intercept('GET', '/api/schedule', {
    statusCode: 200,
    body: { success: true, schedules: [] },
  }).as('getSchedules');

  cy.intercept('GET', '/api/schedule/status**', {
    statusCode: 200,
    body: { success: true, upcoming: [], recent: [] },
  }).as('getScheduleStatus');

}

function seedUserMetadata(userMetadata: Record<string, unknown>): void {
  const cookieName = authCookieName();
  cy.getCookie(cookieName).then((cookie) => {
    if (cookie === null || typeof cookie.value !== 'string') {
      throw new Error('loginE2EUser did not write the session cookie');
    }
    const encoded = cookie.value.replace(/^base64-/, '');
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const session = JSON.parse(atob(padded)) as Record<string, unknown>;
    const user = session.user as Record<string, unknown>;
    session.user = { ...user, user_metadata: userMetadata };
    const next = window
      .btoa(JSON.stringify(session))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    cy.setCookie(cookieName, `base64-${next}`);
  });
}

const TALL_VIEWPORT: [number, number] = [1280, 1440];

function visitHomeAsReturningUser(): void {
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
}

describe('Main Layout — Sidebar', () => {
  beforeEach(() => {
    cy.viewport(...TALL_VIEWPORT);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('navega entre as páginas clicando nas abas da sidebar', () => {
    visitHomeAsReturningUser();
    cy.get('[data-testid=nav-brand]').should('be.visible');

    cy.contains('a', 'Contas').click();
    cy.url().should('include', '/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Publicações').click();
    cy.url().should('include', '/posts');
  });

  it('destaca a aba ativa conforme a rota atual', () => {
    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Contas')
      .should('have.attr', 'class')
      .and('contain', 'bg-brand-soft');

    cy.contains('a', 'Publicações')
      .should('have.attr', 'class')
      .and('not.contain', 'bg-brand-soft');
  });

  it('exibe o avatar do utilizador no rodapé da sidebar', () => {
    seedUserMetadata({ name: 'Cypress', avatar_url: '/cypress-avatar.png' });
    visitHomeAsReturningUser();
    cy.get('aside img[alt="Cypress"]', { timeout: 10_000 }).should('exist');
  });

  it('exibe o nome do usuário autenticado no rodapé da sidebar', () => {
    seedUserMetadata({ name: 'Cypress' });
    visitHomeAsReturningUser();
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });

  it('permite sair da conta pelo rodapé da sidebar', () => {
    seedUserMetadata({ name: 'Cypress' });
    visitHomeAsReturningUser();
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.intercept('POST', '**/auth/v1/logout*', { statusCode: 204 });

    cy.get('button[title="Sair"]').click();
    cy.url().should('match', /\/login$/);
  });

});

describe('Sign out everywhere — /account page', () => {
  beforeEach(() => {
    cy.viewport(...TALL_VIEWPORT);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('pede confirmação antes de sair de todos os dispositivos', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/account');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.get('[data-testid=sign-out-all-confirm]').should('be.visible');
    cy.get('[data-testid=sign-out-all-cancel]').should('be.visible');

    cy.get('[data-testid=sign-out-all-cancel]').click();
    cy.get('[data-testid=sign-out-all-dialog]').should('not.exist');
  });

  it('confirma o sair de todos os dispositivos com o logout stubado (nunca real)', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/account');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.intercept('POST', '**/auth/v1/logout*', { statusCode: 204 });

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.get('[data-testid=sign-out-all-confirm]').click();
    cy.url().should('match', /\/login$/);
  });

  it('mostra o erro retryable quando o sair de todos falha (stub 500)', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/account');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.intercept('POST', '**/auth/v1/logout*', { statusCode: 500, body: { msg: 'kaboom' } });

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.get('[data-testid=sign-out-all-confirm]').click();
    cy.get('[data-testid=sign-out-all-error]').should('be.visible');
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.url().should('not.match', /\/login$/);
  });

  it('o diálogo aplica o focus trap e o Escape', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/account');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-cancel');

    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-confirm');

    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-cancel');

    cy.document().then((doc) => {
      (doc.activeElement as HTMLElement | null)?.blur();
    });
    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-cancel');

    cy.window().then((win) => {
      win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    cy.get('[data-testid=sign-out-all-dialog]').should('not.exist');
  });

  it('com o sign-out em curso, o Tab fica preso no diálogo', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/account');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.intercept('POST', '**/auth/v1/logout*', (req) => {
      req.reply({ statusCode: 204, delay: 100_000 });
    });

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.get('[data-testid=sign-out-all-confirm]').click();
    cy.get('[data-testid=sign-out-all-confirm]').should('be.disabled');

    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
  });
});

describe('Main Layout — Sidebar user name fallbacks', () => {
  beforeEach(() => {
    cy.viewport(...TALL_VIEWPORT);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('exibe user_name quando o user_metadata não tem name', () => {
    seedUserMetadata({ user_name: 'ghuser' });
    visitHomeAsReturningUser();
    cy.contains('p', 'ghuser', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });

  it('exibe o provider_id como último fallback de nome', () => {
    seedUserMetadata({ provider_id: 'pid123' });
    visitHomeAsReturningUser();
    cy.contains('p', 'pid123', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });

  it('exibe nome padrão quando o user_metadata está vazio', () => {
    seedUserMetadata({});
    visitHomeAsReturningUser();
    cy.contains('p', 'GitHub User', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });
});

export {};