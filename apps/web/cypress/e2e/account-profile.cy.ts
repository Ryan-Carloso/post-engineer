//---------------
// Account area (Perfil/Profile) — E2E for the mobile header avatar, the
// /account page and the desktop sidebar footer link.
//
// Real Supabase session (loginE2EUser): the middleware validates the
// cookie server-side, so the session must be real. user_metadata is
// rewritten inside the real cookie (access_token stays valid) to drive
// the displayed name/initial — no avatar_url is seeded because
// next/image would reject an unconfigured remote host.
//---------------

//---------------
// Cookie name is derived from the configured Supabase URL at runtime
// (same derivation as support/commands.ts), so these tests work against
// any Supabase project and no real project ref is hardcoded here.
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
// seedUserMetadata — replaces user_metadata inside the real session cookie
// that loginE2EUser wrote, keeping its access_token so the middleware still
// resolves a user. The account UI reads the name/avatar from that metadata.
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
// Intercepts for the requests the shell really fires on mount. The token
// balance fetch is the only one the /account page needs; the rest serve
// the "/" -> posts redirect used by the navigation tests.
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

const MOBILE_VIEWPORT: [number, number] = [390, 844];

//---------------
// The desktop sidebar is h-screen; on a short viewport the footer (user
// block) is clipped off-screen, so the desktop spec uses a tall viewport.
//---------------
const TALL_DESKTOP_VIEWPORT: [number, number] = [1280, 1000];

describe('Account area — mobile header (390px)', () => {
  beforeEach(() => {
    cy.viewport(...MOBILE_VIEWPORT);
    cy.loginE2EUser();
    seedUserMetadata({ name: 'Cypress' });
    interceptShellData();
  });

  it('shows the version badge and the avatar button in the mobile header', () => {
    cy.visit('/');

    cy.get('[data-testid=mobile-header]').should('be.visible');
    cy.get('[data-testid=mobile-header] [data-testid=version-badge]')
      .should('be.visible')
      .and('contain', 'BETA');
    cy.get('[data-testid=mobile-profile-link]')
      .should('be.visible')
      .and('have.attr', 'href', '/account');
    // No avatar_url seeded: the initial-letter fallback circle renders.
    cy.get('[data-testid=mobile-profile-link]').should('contain', 'C');
  });

  it('navigates to /account when the avatar button is clicked', () => {
    cy.visit('/');

    cy.get('[data-testid=mobile-profile-link]').click();
    cy.url().should('include', '/account');
    cy.contains('h1', 'Perfil').should('be.visible');
  });

  it('keeps Home as the first bottom tab and has no API Keys tab', () => {
    cy.visit('/');

    // The bottom nav is the fixed nav; the translated aria-label depends on
    // the locale, so select by layout classes instead.
    cy.get('nav.fixed.bottom-0').as('bottomNav');
    cy.get('@bottomNav')
      .find('a')
      .should('have.length', 5)
      .first()
      .should('have.attr', 'href', '/');
    cy.get('@bottomNav').contains('a', 'API Keys').should('not.exist');
  });
});

describe('Account area — /account page', () => {
  beforeEach(() => {
    cy.viewport(...MOBILE_VIEWPORT);
    cy.loginE2EUser();
    seedUserMetadata({ name: 'Cypress' });
    interceptShellData();
  });

  it('renders user, token balance, version, locale switcher and sign out', () => {
    cy.visit('/account');

    // All assertions are scoped to the page container: the desktop sidebar
    // (hidden on mobile via CSS) renders a second AccountPanel in the DOM.
    cy.get('[data-testid=account-page]').as('page');

    cy.get('@page').contains('h1', 'Perfil').should('be.visible');

    cy.get('@page')
      .find('[data-testid=profile-user-link]')
      .should('be.visible')
      .and('have.attr', 'href', '/account')
      .and('contain', 'Cypress');

    // The client really fires /api/billing/tokens on mount (TokenBalance).
    cy.wait('@getTokens');
    cy.get('@page').find('[data-testid=token-balance]').should('contain', '100');

    cy.get('@page')
      .find('[data-testid=version-badge]')
      .should('have.length', 1)
      .and('contain', 'BETA');

    cy.get('@page').contains('button', 'PT').should('be.visible');
    cy.get('@page').contains('button', 'EN').should('be.visible');

    cy.get('@page').find('button[title="Sair"]').should('be.visible');

    cy.get('@page')
      .find('[data-testid=profile-api-keys-link]')
      .should('be.visible')
      .and('have.attr', 'href', '/api-keys');
  });

  it('navigates to /api-keys from the profile API Keys row', () => {
    cy.visit('/account');

    cy.get('[data-testid=account-page]')
      .find('[data-testid=profile-api-keys-link]')
      .click();
    cy.url().should('include', '/api-keys');
  });

  it('signs out and lands on /login', () => {
    cy.visit('/account');

    cy.get('[data-testid=account-page]').find('button[title="Sair"]').scrollIntoView().click();
    cy.url().should('match', /\/login$/);
  });
});

describe('Account area — desktop sidebar footer', () => {
  beforeEach(() => {
    cy.viewport(...TALL_DESKTOP_VIEWPORT);
    cy.loginE2EUser();
    seedUserMetadata({ name: 'Cypress' });
    interceptShellData();
  });

  it('sidebar keeps Home first and has no API Keys tab', () => {
    cy.visit('/');

    // Sidebar nav: Home first, API Keys moved to the profile area.
    cy.get('aside nav')
      .first()
      .find('a')
      .should('have.length', 5)
      .first()
      .should('have.attr', 'href', '/');
    cy.get('aside nav').first().contains('a', 'API Keys').should('not.exist');
  });

  it('user block links to /account', () => {
    cy.visit('/');

    cy.get('[data-testid=profile-user-link]', { timeout: 10_000 })
      .scrollIntoView()
      .should('be.visible')
      .and('have.attr', 'href', '/account')
      .and('contain', 'Cypress');

    cy.get('[data-testid=profile-user-link]').click();
    cy.url().should('include', '/account');
    cy.contains('h1', 'Perfil').should('be.visible');
  });
});

export {};
