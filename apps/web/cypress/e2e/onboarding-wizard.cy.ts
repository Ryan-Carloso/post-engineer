//---------------
// First-visit onboarding wizard (issue #573): opens on a first visit to
// /posts, walks four steps, persists the step across a detour, and stays
// closed once seen. Every app-page spec logs in for real; the page's API
// reads are intercepted with empty payloads so the wizard is the only
// thing under test. PT is the default locale; EN is pinned via localStorage.
//---------------

// The wizard keys live in lib/onboarding-wizard.ts; a Cypress spec cannot
// import the module, so the literals are pinned here.
const SEEN_KEY = 'post-engineer-onboarding-wizard-seen';
const STEP_KEY = 'post-engineer-onboarding-wizard-step';

function visitPosts(setup?: (win: Window) => void) {
  cy.visit('/posts', {
    onBeforeLoad(win) {
      setup?.(win);
    },
  });
}

describe('Onboarding wizard', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/list', { authenticated: true, personas: [] }).as('personas');
    cy.intercept('GET', '/api/account', { authenticated: true, accounts: [] }).as('accounts');
    cy.intercept('GET', '/api/persona/video-generations*', { success: true, generations: [] }).as('generations');
    cy.intercept('GET', '/api/schedule', { success: true, schedules: [] }).as('schedules');
    cy.intercept('GET', '/api/schedule/status*', { success: true, upcoming: [], recent: [], slots: [] }).as('status');
  });

  it('opens on the first visit and walks all four steps', () => {
    visitPosts();
    cy.get('[data-testid=onboarding-wizard-dialog]').should('be.visible');
    cy.contains('Bem-vindo ao Post Engineer').should('be.visible');
    cy.contains('Passo 1 de 4').should('be.visible');

    cy.contains('button', 'Continuar').click();
    cy.contains('Conecte a sua conta').should('be.visible');
    cy.contains('Passo 2 de 4').should('be.visible');
    // Step 2 connects inline: rows are buttons, never links to /accounts,
    // and the duplicate "Conectar conta" button is gone.
    cy.get('[data-testid=onboarding-provider-youtube]').should('not.have.attr', 'href');
    cy.contains('a', 'Conectar conta').should('not.exist');
    cy.get('[data-testid=onboarding-provider-youtube]').click();
    cy.get('[data-testid=onboarding-provider-back]').should('be.visible');
    cy.contains('button', 'Conectar uma conta').should('be.visible');
    cy.get('[data-testid=onboarding-provider-back]').click();
    cy.contains('Conecte a sua conta').should('be.visible');

    cy.contains('button', 'Pular por agora').click();
    cy.contains('Ligue o seu agente').should('be.visible');
    cy.contains('Crie uma chave de API.').should('be.visible');
    cy.contains('Cole o setup no agente.').should('be.visible');
    cy.contains('Diga o que publicar e quando.').should('be.visible');
    cy.contains('a', 'Abrir o prompt de setup')
      .should('have.attr', 'href', '/recipes')
      .and('have.attr', 'target', '_blank');

    cy.contains('button', 'Já liguei o agente').click();
    cy.contains('Os seus tokens').should('be.visible');
    cy.contains('Fale connosco e ganhe 3 tokens grátis.').should('be.visible');
    cy.get('[data-testid=onboarding-email-cta]').should('have.attr', 'href', 'mailto:madebyryandev@gmail.com');

    cy.contains('button', 'Começar a publicar').click();
    cy.get('[data-testid=onboarding-wizard-dialog]').should('not.exist');
    cy.window().then((win) => {
      expect(win.localStorage.getItem(SEEN_KEY)).to.eq('1');
    });
  });

  it('connects inline without leaving /posts', () => {
    visitPosts();
    cy.contains('button', 'Continuar').click();
    cy.get('[data-testid=onboarding-provider-youtube]').click();
    cy.url().should('include', '/posts');
    cy.get('[data-testid=onboarding-wizard-dialog]').should('be.visible');
    cy.contains('Passo 2 de 4').should('be.visible');
    cy.get('[data-testid=onboarding-provider-back]').should('be.visible');
  });

  it('resumes at the saved step after a detour', () => {
    visitPosts((win) => {
      win.localStorage.setItem(STEP_KEY, '2');
    });
    cy.contains('Conecte a sua conta').should('be.visible');
    cy.contains('Passo 2 de 4').should('be.visible');
  });

  it('stays closed once seen, and reopens from the header button', () => {
    visitPosts((win) => {
      win.localStorage.setItem(SEEN_KEY, '1');
    });
    cy.get('[data-testid=onboarding-wizard-dialog]').should('not.exist');
    cy.get('[data-testid=onboarding-reopen-button]').click();
    cy.get('[data-testid=onboarding-wizard-dialog]').should('be.visible');
    cy.contains('Bem-vindo ao Post Engineer').should('be.visible');
    cy.contains('Passo 1 de 4').should('be.visible');
  });

  it('closes from the X button and marks the visit seen', () => {
    visitPosts();
    cy.get('[data-testid=onboarding-wizard-dialog]').should('be.visible');
    cy.get('[data-testid=onboarding-wizard-dialog]').contains('button', 'Close').click();
    cy.get('[data-testid=onboarding-wizard-dialog]').should('not.exist');
    cy.window().then((win) => {
      expect(win.localStorage.getItem(SEEN_KEY)).to.eq('1');
    });
  });

  it('shows the English copy when the locale is en', () => {
    visitPosts((win) => {
      win.localStorage.setItem('social-hub-locale', 'en');
    });
    cy.contains('Welcome to Post Engineer').should('be.visible');
    cy.contains('Step 1 of 4').should('be.visible');
    cy.contains('button', 'Continue').click();
    cy.contains('Connect your account').should('be.visible');
  });

  it('opens on a narrow screen', () => {
    cy.viewport(390, 844);
    visitPosts();
    cy.get('[data-testid=onboarding-wizard-dialog]').should('be.visible');
    cy.contains('Bem-vindo ao Post Engineer').should('be.visible');
    cy.contains('button', 'Continuar').click();
    cy.contains('Conecte a sua conta').should('be.visible');
  });
});

export {};
