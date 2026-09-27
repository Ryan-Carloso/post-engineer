//---------------
// Debug video — garante que o formulário envia dados suficientes para
// derivar video_subject antes de chamar o engine.
//---------------

describe('Debug video', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress', avatar_url: '' } },
    });
    cy.intercept('GET', '/api/persona/voices', {
      statusCode: 200,
      body: { voices: [{ id: 'energetic', name: 'Voz enérgica' }] },
    });
    cy.intercept('GET', '/api/persona/voice-sample-languages', {
      statusCode: 200,
      body: { languages: [{ code: 'pt', label: 'Português' }] },
    });
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: { authenticated: true, personas: [] },
    });
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [] },
    });
  });

  it('envia nicho e roteiro para gerar video_subject no backend', () => {
    cy.intercept('POST', '/api/persona/video-job', (request) => {
      expect(String(request.body)).to.contain('finanças');
      request.reply({ statusCode: 200, body: { success: true, taskId: 'debug-task-1', tokensSpent: 0.5 } });
    }).as('createDebugVideo');
    cy.intercept('GET', '/api/persona/video-status/debug-task-1', {
      statusCode: 200,
      body: { success: true, state: 0, progress: 0.1 },
    });

    cy.visit('/persona');
    // Destrava o debug mode: 10 cliques na marca da sidebar.
    cy.get('[data-testid=nav-brand]').click({ multiple: false }).click().click().click().click().click().click().click().click().click().click();
    cy.get('[data-testid=persona-niche]').type('finanças');
    cy.get('textarea').first().type('Como organizar o orçamento mensal');
    cy.contains('button', 'Gerar vídeo para download').click();

    cy.wait('@createDebugVideo');
    cy.contains('Gerando vídeo').should('be.visible');
  });
});
