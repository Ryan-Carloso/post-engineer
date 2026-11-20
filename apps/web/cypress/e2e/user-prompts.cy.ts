const HASH = 'a'.repeat(64);
const REVIEW_ID = '7b0e6c1e-0000-4000-8000-000000000002';

const OFFICIAL = {
  slug: 'daily-news',
  title: 'Daily news becomes a video',
  description: 'Turn one news story of the day into one persona video.',
  source: 'official',
  status: null,
  rejectionReason: null,
};

function ownPrompt(slug: string, status: string) {
  return {
    slug,
    title: `Title ${slug}`,
    description: `About ${slug}`,
    source: 'own',
    status,
    rejectionReason: null,
  };
}

const COMMUNITY = {
  slug: 'shared-by-someone',
  title: 'Shared by someone',
  description: 'A community prompt.',
  source: 'community',
  status: null,
  rejectionReason: null,
};

function visitEnglish(path: string) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('social-hub-locale', 'en');
    },
  });
}

function interceptShell(): void {
  cy.intercept('GET', '/api/account', { statusCode: 200, body: { authenticated: true, accounts: [], message: 'ok' } });
  cy.intercept('GET', '/api/billing/tokens', { statusCode: 200, body: { success: true, balance: 100 } });
  cy.intercept('GET', '/api/schedule', { statusCode: 200, body: { success: true, schedules: [] } });
  cy.intercept('GET', '/api/schedule/status**', { statusCode: 200, body: { success: true, upcoming: [], recent: [] } });
  cy.intercept('GET', '/api/persona/video-generations**', { statusCode: 200, body: { success: true, generations: [] } });
}

describe('Your prompts on the hub', () => {
  beforeEach(() => {
    cy.viewport(1280, 1100);
    cy.loginE2EUser();
  });

  it('lists own prompts with their status and community prompts apart, then creates one', () => {
    let prompts: unknown[] = [OFFICIAL, ownPrompt('mine', 'private'), COMMUNITY];
    cy.intercept('GET', '/api/prompts', (request) => {
      request.reply({ statusCode: 200, body: { success: true, prompts } });
    }).as('listPrompts');
    cy.intercept('POST', '/api/prompts', (request) => {
      prompts = [...prompts, ownPrompt('fresh-one', 'private')];
      request.reply({
        statusCode: 201,
        body: { success: true, prompt: { ...ownPrompt('fresh-one', 'private'), prompt: request.body.prompt } },
      });
    }).as('createPrompt');

    visitEnglish('/recipes');
    cy.wait('@listPrompts');
    cy.get('[data-testid="user-prompt-status-mine"]').scrollIntoView().should('contain', 'Private');
    cy.contains('h3', 'Community prompts').should('be.visible');
    cy.get('[data-testid="user-prompt-shared-by-someone"]').should('contain', 'Community');

    cy.get('[data-testid="new-user-prompt-btn"]').click();
    cy.get('[data-testid="user-prompt-form"]').within(() => {
      cy.contains('label', 'Slug').find('input').type('fresh-one');
      cy.contains('label', 'Title').find('input').type('Fresh one');
      cy.contains('label', 'Prompt text').find('textarea').type('Write three beats.');
      cy.contains('button', 'Save').click();
    });
    cy.wait('@createPrompt').its('request.body').should('deep.equal', {
      slug: 'fresh-one',
      title: 'Fresh one',
      description: '',
      prompt: 'Write three beats.',
    });
    cy.get('[data-testid="user-prompt-form"]').should('not.exist');
    cy.get('[data-testid="user-prompt-fresh-one"]').should('be.visible');
  });

  it('asks to publish a private prompt and shows it waiting for review', () => {
    let prompts: unknown[] = [OFFICIAL, ownPrompt('mine', 'private')];
    cy.intercept('GET', '/api/prompts', (request) => {
      request.reply({ statusCode: 200, body: { success: true, prompts } });
    }).as('listPrompts');
    cy.intercept('POST', '/api/prompts/mine/visibility', (request) => {
      prompts = [OFFICIAL, ownPrompt('mine', 'pending')];
      request.reply({ statusCode: 200, body: { success: true, prompt: { ...ownPrompt('mine', 'pending'), prompt: 'Text' } } });
    }).as('publish');

    visitEnglish('/recipes');
    cy.wait('@listPrompts');
    cy.get('[data-testid="user-prompt-mine"]').scrollIntoView().contains('button', 'Ask to publish').click();
    cy.wait('@publish').its('request.body').should('deep.equal', { visibility: 'public' });
    cy.get('[data-testid="user-prompt-status-mine"]').should('contain', 'Waiting for review');
  });
});

describe('Prompt review page', () => {
  const entry = {
    id: REVIEW_ID,
    slug: 'waiting',
    title: 'Waiting prompt',
    description: 'About it',
    prompt: 'The whole text\nacross two lines',
    contentHash: HASH,
    authorId: 'author-1',
    requestedAt: '2026-11-20T00:00:00Z',
  };

  beforeEach(() => {
    cy.viewport(1280, 1100);
    cy.loginE2EUser();
    interceptShell();
  });

  it('approves the exact text the reviewer read', () => {
    cy.intercept('GET', '/api/admin/prompts', {
      statusCode: 200,
      body: { success: true, truncated: false, prompts: [entry] },
    }).as('queue');
    cy.intercept('POST', `/api/admin/prompts/${REVIEW_ID}/review`, {
      statusCode: 200,
      body: { success: true, slug: 'waiting', status: 'approved' },
    }).as('review');

    visitEnglish('/admin/prompts');
    cy.wait('@queue');
    cy.contains('h1', 'Prompt review').should('be.visible');
    cy.get('[data-testid="prompt-review-text-waiting"]').should('contain', 'The whole text');
    cy.get('[data-testid="prompt-review-waiting"]').contains('button', 'Approve').click();
    cy.wait('@review').its('request.body').should('deep.equal', { decision: 'approve', contentHash: HASH });
    cy.contains('Decision saved.').should('be.visible');
  });

  it('tells a user who is not a reviewer so', () => {
    cy.intercept('GET', '/api/admin/prompts', {
      statusCode: 403,
      body: { success: false, error: 'Only prompt reviewers can do this.', code: 'PROMPT_REVIEWER_REQUIRED' },
    }).as('queue');
    visitEnglish('/admin/prompts');
    cy.wait('@queue');
    cy.contains('Only prompt reviewers can open this page.').should('be.visible');
  });
});

export {};
