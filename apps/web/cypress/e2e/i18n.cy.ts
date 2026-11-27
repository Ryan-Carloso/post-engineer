function visitHomeAsReturningUser(): void {
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
}

describe('i18n — troca de idioma via UI', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('getSession');

    cy.intercept('GET', '/api/schedule', {
      statusCode: 200,
      body: { success: true, schedules: [] },
    }).as('getSchedules');

    cy.intercept('GET', '/api/schedule/status**', {
      statusCode: 200,
      body: { success: true, upcoming: [], recent: [] },
    }).as('getScheduleStatus');


    visitHomeAsReturningUser();
    cy.wait('@getSchedules');
  });

  it('persiste o idioma escolhido no localStorage entre visitas', () => {
    cy.contains('button', 'EN').click();
    cy.contains('a', 'Networks').should('be.visible');

    cy.window().then((win) => {
      expect(win.localStorage.getItem('social-hub-locale')).to.eq('en');
    });

    cy.visit('/');
    cy.wait('@getSchedules');
    cy.contains('a', 'Networks').should('be.visible');
  });

  it('aplica o idioma salvo no localStorage em outras páginas', () => {
    cy.window().then((win) => {
      win.localStorage.setItem('social-hub-locale', 'en');
    });

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Networks').should('be.visible');
  });

  it('traduz o conteúdo da página de contas ao trocar o idioma', () => {
    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Redes conectadas').should('be.visible');

    cy.contains('button', 'EN').click();
    cy.contains('h1', 'Connected networks').scrollIntoView().should('be.visible');
  });

  it('usa o idioma padrão quando o localStorage tem valor inválido', () => {
    cy.window().then((win) => {
      win.localStorage.setItem('social-hub-locale', 'fr');
    });

    cy.visit('/');
    cy.wait('@getSchedules');

    cy.contains('a', 'Redes').should('be.visible');
  });
});
