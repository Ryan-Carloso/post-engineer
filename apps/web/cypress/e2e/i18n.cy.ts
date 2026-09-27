//---------------
// i18n — UI tests para o provider de internacionalização (lib/i18n/provider).
// Testa troca de idioma via LocaleSwitcher da sidebar e persistência.
//---------------

describe('i18n — troca de idioma via UI', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [], message: 'ok' },
    }).as('getAccounts');

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('getSession');

    cy.intercept('GET', '/api/health', {
      statusCode: 200,
      body: { status: 'ok' },
    }).as('getHealth');

    cy.visit('/');
    cy.wait('@getHealth');
  });

  it('troca labels da sidebar de PT para EN e volta', () => {
    cy.contains('a', 'Início').should('be.visible');

    // PT -> EN
    cy.contains('button', 'EN').click();
    cy.contains('a', 'Home').should('be.visible');
    cy.contains('a', 'Accounts').should('be.visible');
    cy.contains('a', 'App API Key').should('be.visible');
    cy.contains('Operational').should('be.visible');

    // EN -> PT
    cy.contains('button', 'PT').click();
    cy.contains('a', 'Início').should('be.visible');
    cy.contains('Operacional').should('be.visible');
  });

  it('persiste o idioma escolhido no localStorage entre visitas', () => {
    cy.contains('button', 'EN').click();
    cy.contains('a', 'Home').should('be.visible');

    cy.window().then((win) => {
      expect(win.localStorage.getItem('social-hub-locale')).to.eq('en');
    });

    cy.visit('/');
    cy.wait('@getHealth');
    cy.contains('a', 'Home').should('be.visible');
  });

  it('aplica o idioma salvo no localStorage em outras páginas', () => {
    cy.window().then((win) => {
      win.localStorage.setItem('social-hub-locale', 'en');
    });

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('a', 'Accounts').should('be.visible');
  });

  it('traduz o conteúdo da página de contas ao trocar o idioma', () => {
    cy.visit('/accounts');
    cy.wait('@getAccounts');

    cy.contains('h1', 'Contas').should('be.visible');

    cy.contains('button', 'EN').click();
    cy.contains('h1', 'Accounts').should('be.visible');
  });

  it('usa o idioma padrão quando o localStorage tem valor inválido', () => {
    cy.window().then((win) => {
      win.localStorage.setItem('social-hub-locale', 'fr');
    });

    cy.visit('/');
    cy.wait('@getHealth');

    cy.contains('a', 'Início').should('be.visible');
  });
});
