function authCookieName(): string {
  const supabaseUrl = Cypress.env('supabaseUrl') as string | undefined;
  if (typeof supabaseUrl !== 'string' || supabaseUrl.length === 0) {
    throw new Error('CYPRESS_SUPABASE_URL is not defined');
  }
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
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

const MOBILE_VIEWPORT: [number, number] = [390, 844];

function visitHomeAsReturningUser(): void {
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
}

const TALL_DESKTOP_VIEWPORT: [number, number] = [1280, 1100];

describe('Account area — mobile header (390px)', () => {
  beforeEach(() => {
    cy.viewport(...MOBILE_VIEWPORT);
    cy.loginE2EUser();
    seedUserMetadata({ name: 'Cypress' });
    interceptShellData();
  });

  it('shows the version badge and the avatar button in the mobile header', () => {
    visitHomeAsReturningUser();

    cy.get('[data-testid=mobile-header]').should('be.visible');
    cy.get('[data-testid=mobile-header] [data-testid=version-badge]')
      .should('be.visible')
      .and('contain', 'BETA');
    cy.get('[data-testid=mobile-profile-link]')
      .should('be.visible')
      .and('have.attr', 'href', '/account');
    cy.get('[data-testid=mobile-profile-link]').should('contain', 'C');
  });

  it('navigates to /account when the avatar button is clicked', () => {
    visitHomeAsReturningUser();

    cy.get('[data-testid=mobile-profile-link]').click();
    cy.url().should('include', '/account');
    cy.contains('h1', 'Perfil').should('be.visible');
  });

  it('opens History from the More sheet', () => {
    visitHomeAsReturningUser();

    cy.get('nav.fixed.bottom-0').contains('button', 'Mais').click();
    cy.get('[role=dialog]').within(() => {
      cy.contains('a', 'Perfil').should('not.exist');
      cy.contains('a', 'Histórico').click();
    });
    cy.url().should('include', '/posts/history');
    cy.contains('h1', 'Histórico').should('be.visible');
  });

  it('has four bottom tab links starting at /posts plus More', () => {
    visitHomeAsReturningUser();

    cy.get('nav.fixed.bottom-0').as('bottomNav');
    cy.get('@bottomNav')
      .find('a')
      .should('have.length', 4)
      .first()
      .should('have.attr', 'href', '/posts');
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

  it('navigates to the prompts hub from the profile API Keys row', () => {
    cy.visit('/account');

    cy.get('[data-testid=account-page]')
      .find('[data-testid=profile-api-keys-link]')
      .click();
    cy.location('pathname').should('eq', '/recipes');
  });

  it('signs out and lands on /login', () => {
    cy.visit('/account');

    cy.intercept('POST', '**/auth/v1/logout*', { statusCode: 204 });

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

  it('sidebar has seven tabs starting at /posts and has no API Keys tab', () => {
    visitHomeAsReturningUser();

    cy.get('aside nav')
      .first()
      .find('a')
      .should('have.length', 7)
      .first()
      .should('have.attr', 'href', '/posts');
    cy.get('aside nav').first().find('a[href="/metrics"]').should('have.length', 1);
    cy.get('aside nav').first().find('a[href="/experiments"]').should('have.length', 1);
    cy.get('aside nav').first().contains('a', 'API Keys').should('not.exist');
  });

  it('user block links to /account', () => {
    visitHomeAsReturningUser();

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
