const BOUND_ACCOUNTS = {
  youtube: ['ch-e2e-1'],
  instagram: ['ig-e2e-1'],
  bluesky: [],
  linkedin: [],
  threads: [],
  facebook: [],
  pinterest: [],
  '3speak': [],
  rumble: [],
  fanvue: [],
  telegram: [],
};

const ACCOUNTS = {
  authenticated: true,
  accounts: [
    {
      provider: 'youtube',
      recordId: 'rec-yt-1',
      channelId: 'ch-e2e-1',
      channelName: 'E2E Channel',
      email: 'e2e@example.com',
      connectedAt: 1,
      lastUsed: 1,
    },
    {
      provider: 'instagram',
      recordId: 'rec-ig-1',
      igUserId: 'ig-e2e-1',
      username: 'e2e.insta',
      name: 'E2E Insta',
      connectedAt: 1,
      lastUsed: 1,
    },
  ],
};

const PERSONAS = {
  authenticated: true,
  personas: [
    {
      id: 'persona-e2e-1',
      name: 'E2E Persona',
      created_at: '2026-01-01T00:00:00.000Z',
      ai_label: false,
      boundAccounts: BOUND_ACCOUNTS,
    },
  ],
};

function visitComposer() {
  cy.visit('/posts/new');
  cy.get('[data-testid=composer-form]', { timeout: 60000 }).should('be.visible');
}

describe('web post composer', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    cy.intercept('GET', '/api/persona/list', PERSONAS).as('personas');
    cy.intercept('GET', '/api/account', ACCOUNTS).as('accounts');
    cy.intercept('GET', '**/rest/v1/user_profiles?select=access_until*', {
      statusCode: 200,
      body: [{ access_until: '2099-01-01T00:00:00.000Z', subscription_status: 'active' }],
    });
    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    }).as('session');
  });

  it('renders the composer in both locales on desktop', () => {
    cy.viewport(1200, 700);
    visitComposer();
    cy.get('[data-testid=composer-media]').should('contain', 'Escolher arquivo');
    cy.get('[data-testid=composer-accounts]').should('contain', 'YouTube');
    cy.get('[data-testid=composer-accounts]').should('contain', 'E2E Channel');
    cy.get('[data-testid=composer-accounts]').should('contain', 'Instagram');
    cy.get('[data-testid=composer-fields]').should('contain', 'Texto do post');
    cy.get('[data-testid=composer-when]').should('contain', 'Agendar');
    cy.get('[data-testid=composer-submit]').should('contain', 'Agendar post');
    cy.screenshot('post-composer-desktop-pt', { capture: 'viewport' });

    cy.contains('button', 'EN').click();
    cy.get('[data-testid=composer-fields]').should('contain', 'Post text');
    cy.get('[data-testid=composer-submit]').should('contain', 'Schedule post');
    cy.screenshot('post-composer-desktop-en', { capture: 'viewport' });
  });

  it('fills an image post and switches to publishing now', () => {
    cy.viewport(1200, 700);
    visitComposer();
    cy.get('[data-testid=composer-file-input]').selectFile('cypress/fixtures/composer-preview.png', {
      force: true,
    });
    cy.get('[data-testid=composer-image-preview]').should('be.visible');
    cy.get('[data-testid=composer-media]').scrollIntoView();
    cy.screenshot('post-composer-media-pt', { capture: 'viewport' });
    cy.contains('[data-testid=account-card]', '@e2e.insta').find('[data-testid=account-card-select]').check();
    cy.get('#composer-title').type('Uma foto do dia');
    cy.get('#composer-description').type('Legenda curta para a imagem.');
    cy.get('[data-testid=composer-when]').contains('button', 'Publicar agora').click();
    cy.get('#composer-caption').should('be.visible');
    cy.get('#composer-tags').should('not.exist');
    cy.get('[data-testid=composer-submit]').should('contain', 'Publicar agora').and('be.enabled');
    cy.screenshot('post-composer-filled-pt', { capture: 'viewport' });
  });

  it('drops the video-only accounts when the media becomes an image', () => {
    visitComposer();
    cy.contains('[data-testid=account-card]', 'E2E Channel').find('[data-testid=account-card-select]').check();
    cy.get('[data-testid=composer-file-input]').selectFile('cypress/fixtures/composer-preview.png', {
      force: true,
    });
    cy.get('[data-testid=composer-accounts]').should('not.contain', 'E2E Channel');
    cy.get('[data-testid=composer-accounts]').should('contain', '@e2e.insta');
  });

  it('preselects the accounts bound to the persona', () => {
    visitComposer();
    cy.get('#composer-persona').select('persona-e2e-1');
    cy.contains('[data-testid=account-card]', 'E2E Channel')
      .find('[data-testid=account-card-select]')
      .should('be.checked');
  });

  it('reports the missing media instead of publishing', () => {
    visitComposer();
    cy.get('[data-testid=composer-submit]').click();
    cy.get('[data-testid=composer-media]').should('contain', 'Escolha um arquivo para publicar.');
    cy.get('[data-testid=composer-form]').should('be.visible');
  });

  it('stacks the sections on mobile', () => {
    cy.viewport(390, 700);
    visitComposer();
    cy.get('[data-testid=composer-submit]').scrollIntoView().should('be.visible');
    cy.screenshot('post-composer-mobile-pt', { capture: 'viewport' });
  });
});
