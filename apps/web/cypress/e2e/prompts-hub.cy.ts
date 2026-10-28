//---------------
// Prompts hub — the public /recipes list and detail pages.
// No login: the hub is public by middleware, so these specs visit
// without cy.loginE2EUser(). English is pinned via localStorage
// before the app reads it, so assertions use the EN copy.
// Visiting every page is also what the ui-coverage-gates cypress
// gate measures: the list and detail route files must be executed
// by E2E, not only by unit tests.
//---------------

function visitEnglish(path: string) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('social-hub-locale', 'en');
    },
  });
}

describe('Prompts hub', () => {
  it('lists both prompts with links to their detail pages', () => {
    visitEnglish('/recipes');
    cy.contains('h1', 'Get your prompts').should('be.visible');
    cy.contains('Daily news becomes a video').should('be.visible');
    cy.contains('GitHub PRs become videos').should('be.visible');
    cy.get('a[href="/recipes/daily-news"]').should('be.visible');
    cy.get('a[href="/recipes/github-prs"]').should('be.visible');
  });

  it('shows the daily-news detail: steps, copy button, GitHub last', () => {
    visitEnglish('/recipes/daily-news');
    cy.contains('h1', 'Daily news becomes a video').should('be.visible');
    cy.contains('h2', 'What this prompt does').should('be.visible');
    cy.contains('button', 'Copy this prompt').should('be.visible');
    cy.get('a[href*="docs/recipes/daily-news.md"]').should('be.visible');
  });

  it('shows the GitHub PRs detail: steps and copy button', () => {
    visitEnglish('/recipes/github-prs');
    cy.contains('h1', 'GitHub PRs become videos').should('be.visible');
    cy.contains('h2', 'What this prompt does').should('be.visible');
    cy.contains('button', 'Copy this prompt').should('be.visible');
    cy.get('a[href*="docs/recipes/github-prs.md"]').should('be.visible');
  });

  it('shows a not-found line with a back link for an unknown slug', () => {
    visitEnglish('/recipes/no-such-prompt');
    cy.contains('This prompt does not exist yet.').should('be.visible');
    cy.get('a[href="/recipes"]').should('be.visible');
  });
});

export {};
