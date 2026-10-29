//---------------
// Main Layout — UI tests para o layout compartilhado app/(main)/layout.tsx.
// Testa a sidebar: abas de navegação, aba ativa, marca e usuário no rodapé.
//
// Sessão REAL no Supabase (usuário de teste do repo): o middleware valida o
// cookie server-side, então um cookie semeado à mão devolve /landing e a
// sidebar nunca renderiza. Para exercitar o nome exibido no rodapé, o helper
// reescreve só o user_metadata do cookie real — o access_token continua
// válido para o middleware.
//---------------

//---------------
// Cookie name is derived from the configured Supabase URL at runtime
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

//---------------
// The sidebar footer renders the token balance and the user; nothing in the
// client calls /api/health, so there is no health indicator to intercept.
//---------------
function interceptShellData(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  }).as('getAccounts');

  cy.intercept('GET', '/api/billing/tokens', {
    statusCode: 200,
    body: { success: true, balance: 100 },
  }).as('getTokens');

  // "/" redirects to the posts list, which loads these on mount.
  cy.intercept('GET', '/api/schedule', {
    statusCode: 200,
    body: { success: true, schedules: [] },
  }).as('getSchedules');

  cy.intercept('GET', '/api/schedule/status**', {
    statusCode: 200,
    body: { success: true, upcoming: [], recent: [] },
  }).as('getScheduleStatus');

  cy.intercept('GET', '/api/persona/video-generations**', {
    statusCode: 200,
    body: { success: true, generations: [] },
  }).as('getGenerations');
}

//---------------
// seedUserMetadata — replaces user_metadata inside the real session cookie
// that loginE2EUser wrote, keeping its access_token so the middleware still
// resolves a user. SidebarUser reads the name from that metadata
// (app-shell.tsx), so this drives every name fallback.
//---------------
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

//---------------
// The shell is `h-dvh overflow-hidden` with a `h-screen` sidebar, so on a
// short viewport the footer (locale, tokens, user, api keys, sign out) is
// clipped off-screen. Cypress reports the clipped elements as not visible
// and cannot click them, so these specs use a viewport tall enough for the
// whole sidebar. Height covers all five tabs (Metrics added ~80px).
//---------------
const TALL_VIEWPORT: [number, number] = [1280, 1440];

describe('Main Layout — Sidebar', () => {
  beforeEach(() => {
    cy.viewport(...TALL_VIEWPORT);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('renders brand, subtitle and nav tabs, without a Home tab', () => {
    cy.visit('/');

    cy.get('[data-testid=nav-brand]').should('be.visible');
    cy.contains('Post Engineer').should('be.visible');
    cy.contains('YouTube · Instagram').should('be.visible');

    cy.contains('a', 'Início').should('not.exist');
    cy.contains('a', 'Posts').should('be.visible');
    cy.contains('a', 'Contas').should('be.visible');
    cy.contains('a', 'Personas').should('be.visible');
    cy.contains('a', 'Métricas').should('be.visible');
    cy.contains('a', 'Pegue seus prompts').should('be.visible');
    // Billing is no longer a nav tab — it lives in the profile area
    // (sidebar footer), reachable from every page, like API Keys.
    cy.contains('a', 'Tokens').should('not.exist');
    cy.get('[data-testid=profile-api-keys-link]').should('be.visible');
    cy.get('[data-testid=profile-billing-link]').should('be.visible');
  });

  it('navega entre as páginas clicando nas abas da sidebar', () => {
    cy.visit('/');
    // Middleware bounces to /landing when the session cookie is not yet
    // attached to this document — wait for the shell before navigating.
    cy.get('[data-testid=nav-brand]').should('be.visible');

    cy.contains('a', 'Contas').click();
    cy.url().should('include', '/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Posts').click();
    cy.url().should('include', '/posts');
  });

  it('destaca a aba ativa conforme a rota atual', () => {
    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Contas')
      .should('have.attr', 'class')
      .and('contain', 'bg-[#fff3f2]');

    cy.contains('a', 'Posts')
      .should('have.attr', 'class')
      .and('not.contain', 'bg-[#fff3f2]');
  });

  it('exibe o avatar do utilizador no rodapé da sidebar', () => {
    // avatar_url present: the AvatarCircle renders the image branch.
    seedUserMetadata({ name: 'Cypress', avatar_url: '/cypress-avatar.png' });
    cy.visit('/');
    cy.get('aside img[alt="Cypress"]', { timeout: 10_000 }).should('exist');
  });

  it('exibe o nome do usuário autenticado no rodapé da sidebar', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });

  it('permite sair da conta pelo rodapé da sidebar', () => {
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    // Stub the auth-server logout call: these specs share one E2E
    // account with the parallel cypress job, and a real sign-out here
    // would revoke its session mid-run (the /landing bounce).
    cy.intercept('POST', '**/auth/v1/logout*', { statusCode: 204 });

    cy.get('button[title="Sair"]').click();
    cy.url().should('match', /\/login$/);
  });

  it('pede confirmação antes de sair de todos os dispositivos', () => {
    // The confirmation dialog is the boundary: confirming here would fire
    // a GLOBAL sign-out against the shared E2E account, revoking the
    // session of the parallel cypress job mid-run (the /landing bounce).
    // The global path's behavior is pinned by the unit tests instead.
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.get('[data-testid=sign-out-all-confirm]').should('be.visible');
    cy.get('[data-testid=sign-out-all-cancel]').should('be.visible');

    cy.get('[data-testid=sign-out-all-cancel]').click();
    cy.get('[data-testid=sign-out-all-dialog]').should('not.exist');
  });

  it('confirma o sair de todos os dispositivos com o logout stubado (nunca real)', () => {
    // The confirmation dialog is the boundary: confirming here would fire
    // a GLOBAL sign-out against the shared E2E account. The auth-server
    // logout call is stubbed, so only the UI flow is exercised.
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.intercept('POST', '**/auth/v1/logout*', { statusCode: 204 });

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    cy.get('[data-testid=sign-out-all-confirm]').click();
    cy.url().should('match', /\/login$/);
  });

  it('mostra o erro retryable quando o sair de todos falha (stub 500)', () => {
    // Failure path: the dialog stays open with the retryable alert and
    // the user is NOT routed away (other devices stay signed in).
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
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
    // Keyboard behavior of the destructive dialog, exercised for real
    // through the window keydown handler: Tab must never escape the
    // modal (from inside with wrap-around, or from outside — e.g. body)
    // and Escape closes while the sign-out is not pending.
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
    cy.contains('p', 'Cypress', { timeout: 10_000 }).scrollIntoView().should('be.visible');

    cy.get('[data-testid=sign-out-all-button]').scrollIntoView().click();
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
    // The dialog focuses the safe action on mount.
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-cancel');

    // Shift+Tab at the FIRST focusable wraps to the last (Confirm).
    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-confirm');

    // Tab at the LAST focusable wraps back to the first (Cancel).
    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-cancel');

    // Focus outside the dialog (document.body): Tab is pulled back inside
    // instead of escaping the modal.
    cy.document().then((doc) => {
      (doc.activeElement as HTMLElement | null)?.blur();
    });
    cy.window().then((win) => {
      win.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    cy.focused().should('have.attr', 'data-testid', 'sign-out-all-cancel');

    // Escape closes while nothing is pending.
    cy.window().then((win) => {
      win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    cy.get('[data-testid=sign-out-all-dialog]').should('not.exist');
  });

  it('com o sign-out em curso, o Tab fica preso no diálogo', () => {
    // While pending every control is disabled, so Tab must be cancelled
    // instead of escaping the dialog. The logout is stubbed with a
    // 100s delay so the request stays in flight for the assertion.
    seedUserMetadata({ name: 'Cypress' });
    cy.visit('/');
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
    // Dialog still open (the test ends before the delayed stub settles).
    cy.get('[data-testid=sign-out-all-dialog]').should('be.visible');
  });
});

//---------------
// The displayed name falls back through user_metadata.name →
// user_metadata.user_name → user_metadata.provider_id → 'GitHub User'
// (app-shell.tsx), so each case needs its own metadata.
//---------------
describe('Main Layout — Sidebar user name fallbacks', () => {
  beforeEach(() => {
    cy.viewport(...TALL_VIEWPORT);
    cy.loginE2EUser();
    interceptShellData();
  });

  it('exibe user_name quando o user_metadata não tem name', () => {
    seedUserMetadata({ user_name: 'ghuser' });
    cy.visit('/');
    cy.contains('p', 'ghuser', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });

  it('exibe o provider_id como último fallback de nome', () => {
    seedUserMetadata({ provider_id: 'pid123' });
    cy.visit('/');
    cy.contains('p', 'pid123', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });

  it('exibe nome padrão quando o user_metadata está vazio', () => {
    seedUserMetadata({});
    cy.visit('/');
    cy.contains('p', 'GitHub User', { timeout: 10_000 }).scrollIntoView().should('be.visible');
  });
});

export {};