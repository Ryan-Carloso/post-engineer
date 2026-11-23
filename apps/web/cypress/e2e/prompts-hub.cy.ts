const VERSION_ID = '44444444-4444-4444-8444-444444444444';

const DAILY_NEWS = {
  slug: 'daily-news',
  title: 'Daily news becomes a video',
  description: 'Turn one news story of the day into one persona video.',
  source: 'community',
  visibility: 'public',
  verified: true,
};

function visitEnglish(path: string) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('social-hub-locale', 'en');
    },
  });
}

function stubPrompts() {
  cy.intercept('GET', '/api/prompts', { statusCode: 200, body: { success: true, prompts: [DAILY_NEWS] } }).as('listPrompts');
  cy.intercept('GET', '/api/prompts/daily-news', {
    statusCode: 200,
    body: { success: true, prompt: { ...DAILY_NEWS, prompt: 'Pick one story of the day.', versionId: VERSION_ID, version: 2 } },
  }).as('getPrompt');
}

describe('Prompts hub', () => {
  it('lists the public prompts from the API with links to their detail pages', () => {
    stubPrompts();
    visitEnglish('/recipes');
    cy.contains('h1', 'Get your prompts').should('be.visible');
    cy.wait('@listPrompts');
    cy.get('[data-testid="public-prompts-section"]')
      .scrollIntoView()
      .within(() => {
        cy.contains('Daily news becomes a video').should('be.visible');
        cy.contains('Verified').should('be.visible');
        cy.get('a[href="/recipes/daily-news"]').should('be.visible');
      });
  });

  it('shows a signed-out visitor the sign-in step and the setup prompt', () => {
    stubPrompts();
    visitEnglish('/recipes');
    cy.get('[data-testid="recipes-sign-in-cta"]')
      .should('be.visible')
      .and('have.attr', 'href', '/login?next=/recipes');
    cy.get('[data-testid="generate-api-key-btn"]').should('not.exist');
    cy.get('[data-testid="mcp-install-prompt"]')
      .scrollIntoView()
      .should('contain', '<MY_API_KEY>');
  });

  it('copies a public prompt straight from its card', () => {
    stubPrompts();
    cy.visit('/recipes', {
      onBeforeLoad(win) {
        win.localStorage.setItem('social-hub-locale', 'en');
        cy.stub(win.navigator.clipboard, 'writeText').resolves();
      },
    });
    cy.wait('@listPrompts');
    cy.get('[data-testid="user-prompt-daily-news"]')
      .scrollIntoView()
      .within(() => {
        cy.contains('button', 'Copy').click();
        cy.wait('@getPrompt');
        cy.contains('button', 'Copied!').should('be.visible');
      });
  });

  it('redirects the old /api-keys page to the hub', () => {
    visitEnglish('/api-keys');
    cy.location('pathname').should('eq', '/recipes');
  });

  it('shows a prompt detail page with its text and copy button', () => {
    stubPrompts();
    visitEnglish('/recipes/daily-news');
    cy.wait('@getPrompt');
    cy.contains('h1', 'Daily news becomes a video').should('be.visible');
    cy.contains('Version 2').should('be.visible');
    cy.get('[data-testid="full-prompt"]').should('contain', 'Pick one story of the day.');
    cy.contains('button', 'Copy this prompt').should('be.visible');
  });

  it('shows a not-found line with a back link for an unknown slug', () => {
    cy.intercept('GET', '/api/prompts/no-such-prompt', { statusCode: 404, body: { success: false, code: 'PROMPT_NOT_FOUND' } }).as('missing');
    visitEnglish('/recipes/no-such-prompt');
    cy.wait('@missing');
    cy.contains('This prompt does not exist yet.').should('be.visible');
    cy.get('a[href="/recipes"]').should('be.visible');
  });
});

export {};
