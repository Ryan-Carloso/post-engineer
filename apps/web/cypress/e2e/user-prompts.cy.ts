function ownPrompt(slug: string, visibility: string) {
  return { slug, title: `Title ${slug}`, description: `About ${slug}`, source: 'own', visibility, verified: false };
}

const COMMUNITY = {
  slug: 'shared-by-someone',
  title: 'Shared by someone',
  description: 'A community prompt.',
  source: 'community',
  visibility: 'public',
  verified: false,
};

function visitEnglish(path: string) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('social-hub-locale', 'en');
    },
  });
}

describe('Your prompts on the hub', () => {
  beforeEach(() => {
    cy.viewport(1280, 1100);
    cy.loginE2EUser();
  });

  it('lists own prompts with their visibility and community prompts apart, then creates one', () => {
    let prompts: unknown[] = [ownPrompt('mine', 'private'), COMMUNITY];
    cy.intercept('GET', '/api/prompts', (request) => {
      request.reply({ statusCode: 200, body: { success: true, prompts } });
    }).as('listPrompts');
    cy.intercept('POST', '/api/prompts', (request) => {
      prompts = [...prompts, ownPrompt('fresh-one', 'private')];
      request.reply({
        statusCode: 201,
        body: { success: true, prompt: { ...ownPrompt('fresh-one', 'private'), prompt: request.body.prompt, versionId: '44444444-4444-4444-8444-444444444444', version: 1 } },
      });
    }).as('createPrompt');

    visitEnglish('/recipes');
    cy.wait('@listPrompts');
    cy.get('[data-testid="user-prompt-visibility-mine"]').scrollIntoView().should('contain', 'Private');
    cy.get('[data-testid="public-prompts-section"] [data-testid="user-prompt-shared-by-someone"]').should('contain', 'Community');
    cy.get('[data-testid="my-prompts-section"] [data-testid="user-prompt-shared-by-someone"]').should('not.exist');

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
      visibility: 'private',
    });
    cy.get('[data-testid="user-prompt-form"]').should('not.exist');
    cy.get('[data-testid="user-prompt-fresh-one"]').should('be.visible');
  });

  it('makes a private prompt public straight from its row', () => {
    let prompts: unknown[] = [ownPrompt('mine', 'private')];
    cy.intercept('GET', '/api/prompts', (request) => {
      request.reply({ statusCode: 200, body: { success: true, prompts } });
    }).as('listPrompts');
    cy.intercept('PATCH', '/api/prompts/mine', (request) => {
      prompts = [ownPrompt('mine', 'public')];
      request.reply({ statusCode: 200, body: { success: true, prompt: { ...ownPrompt('mine', 'public'), prompt: 'Text', versionId: '44444444-4444-4444-8444-444444444444', version: 1 } } });
    }).as('makePublic');

    visitEnglish('/recipes');
    cy.wait('@listPrompts');
    cy.get('[data-testid="user-prompt-mine"]').scrollIntoView().contains('button', 'Make public').click();
    cy.wait('@makePublic').its('request.body').should('deep.equal', { visibility: 'public' });
    cy.get('[data-testid="user-prompt-visibility-mine"]').should('contain', 'Public');
  });
});

export {};
