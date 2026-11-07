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
  it('lists every prompt with links to their detail pages', () => {
    visitEnglish('/recipes');
    cy.contains('h1', 'Get your prompts').should('be.visible');
    cy.contains('Daily news becomes a video').should('be.visible');
    cy.contains('Place spotlight becomes a video').should('be.visible');
    cy.contains('Subject spotlight becomes a video').should('be.visible');
    cy.contains('GitHub PRs become videos').should('be.visible');
    cy.contains('Last 30 days become a video').should('be.visible');
    cy.contains('One week, one video per network').should('be.visible');
    cy.contains('A viral video becomes your Short').should('be.visible');
    cy.get('a[href="/recipes/daily-news"]').should('be.visible');
    cy.get('a[href="/recipes/place-spotlight"]').should('be.visible');
    cy.get('a[href="/recipes/subject-spotlight"]').should('be.visible');
    cy.get('a[href="/recipes/github-prs"]').should('be.visible');
    cy.get('a[href="/recipes/last-30-days"]').should('be.visible');
    cy.get('a[href="/recipes/multi-rede"]').should('be.visible');
    cy.get('a[href="/recipes/viral-shorts"]').should('be.visible');
    cy.get('a[href="/recipes/full-setup"]').should('be.visible');
  });

  it('shows a signed-out visitor the sign-in step and the setup prompt', () => {
    visitEnglish('/recipes');
    cy.get('[data-testid="recipes-sign-in-cta"]')
      .should('be.visible')
      .and('have.attr', 'href', '/login?next=/recipes');
    cy.get('[data-testid="generate-api-key-btn"]').should('not.exist');
    cy.get('[data-testid="mcp-install-prompt"]')
      .scrollIntoView()
      .should('contain', '<MY_API_KEY>');
  });

  it('copies a recipe prompt straight from its card', () => {
    cy.visit('/recipes', {
      onBeforeLoad(win) {
        win.localStorage.setItem('social-hub-locale', 'en');
        // The real clipboard API is permission-gated in the runner; the
        // label flips to Copied! only after this write resolves.
        cy.stub(win.navigator.clipboard, 'writeText').resolves();
      },
    });
    cy.get('[data-testid="copy-prompt-daily-news"]')
      .scrollIntoView()
      .should('contain', 'Copy prompt')
      .click()
      .should('contain', 'Copied!');
  });

  it('redirects the old /api-keys page to the hub', () => {
    visitEnglish('/api-keys');
    cy.location('pathname').should('eq', '/recipes');
  });

  it('shows the daily-news detail: steps, copy button, GitHub last', () => {
    visitEnglish('/recipes/daily-news');
    cy.contains('h1', 'Daily news becomes a video').should('be.visible');
    cy.contains('h2', 'What this prompt does').should('be.visible');
    cy.contains('button', 'Copy this prompt').should('be.visible');
    cy.get('a[href*="docs/recipes/daily-news.md"]').should('be.visible');
  });

  it('shows the place-spotlight detail: steps, copy button, GitHub last', () => {
    visitEnglish('/recipes/place-spotlight');
    cy.contains('h1', 'Place spotlight becomes a video').should('be.visible');
    cy.contains('h2', 'What this prompt does').should('be.visible');
    cy.contains('button', 'Copy this prompt').should('be.visible');
    cy.get('a[href*="docs/recipes/place-spotlight.md"]').should('be.visible');
  });

  it('shows the subject-spotlight detail: steps, copy button, GitHub last', () => {
    visitEnglish('/recipes/subject-spotlight');
    cy.contains('h1', 'Subject spotlight becomes a video').should('be.visible');
    cy.contains('h2', 'What this prompt does').should('be.visible');
    cy.contains('button', 'Copy this prompt').should('be.visible');
    cy.get('a[href*="docs/recipes/subject-spotlight.md"]').should('be.visible');
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
