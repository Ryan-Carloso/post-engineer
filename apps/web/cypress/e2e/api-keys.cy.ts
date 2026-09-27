describe('API Keys tab — UI & E2E', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '**/auth/v1/user*', {
      statusCode: 200,
      body: { id: 'user-1', user_metadata: { name: 'Cypress User', avatar_url: '' } },
    }).as('getSession');

    cy.intercept('GET', '/api/api-keys', {
      statusCode: 200,
      body: { success: true, keys: [] },
    }).as('getApiKeys');
  });

  it('renders the dedicated /api-keys tab with keys section and MCP docs', () => {
    cy.visit('/api-keys');
    cy.wait('@getApiKeys');

    cy.contains('h1', 'API Keys').should('be.visible');
    cy.contains('Nenhuma chave de API gerada ainda.').scrollIntoView().should('be.visible');
    cy.get('[data-testid="generate-api-key-btn"]').scrollIntoView().should('be.visible');

    // MCP docs section with copy install prompt
    cy.contains('Conecte o Post Engineer ao seu agente de IA (MCP)')
      .scrollIntoView()
      .should('be.visible');
    cy.get('[data-testid="copy-mcp-prompt-btn"]').scrollIntoView().should('be.visible');
  });

  it('navigates to /api-keys from the sidebar tab', () => {
    cy.visit('/');
    cy.get('a[href="/api-keys"]').first().click();
    cy.url().should('include', '/api-keys');
    cy.wait('@getApiKeys');
    cy.contains('h1', 'API Keys').should('be.visible');
  });

  it('generates a new API key and displays the secret once', () => {
    cy.intercept('POST', '/api/api-keys', {
      statusCode: 201,
      body: {
        success: true,
        id: 'key-test-123',
        name: 'MCP Automation',
        key: 'pe_live_1234567890abcdef1234567890abcdef',
        keyPrefix: 'pe_live_12345678...',
        createdAt: new Date().toISOString(),
      },
    }).as('createApiKey');

    cy.visit('/api-keys');
    cy.wait('@getApiKeys');

    cy.get('[data-testid="generate-api-key-btn"]').scrollIntoView().click();
    cy.get('[data-testid="create-api-key-form"]').scrollIntoView().should('be.visible');

    cy.get('[data-testid="api-key-name-input"]').type('MCP Automation');
    cy.get('[data-testid="submit-create-key-btn"]').click();

    cy.wait('@createApiKey');

    cy.get('[data-testid="api-key-created-banner"]').scrollIntoView().should('be.visible');
    cy.get('[data-testid="raw-api-key-value"]').should('have.value', 'pe_live_1234567890abcdef1234567890abcdef');
    cy.get('[data-testid="copy-api-key-btn"]').should('be.visible');
  });

  it('allows revoking an active API key', () => {
    cy.intercept('GET', '/api/api-keys', {
      statusCode: 200,
      body: {
        success: true,
        keys: [
          {
            id: 'key-1',
            name: 'Production Server',
            keyPrefix: 'pe_live_prod1234...',
            createdAt: '2026-09-18T10:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
        ],
      },
    }).as('getApiKeysWithKey');

    cy.intercept('DELETE', '/api/api-keys/key-1', {
      statusCode: 200,
      body: { success: true },
    }).as('revokeApiKey');

    cy.visit('/api-keys');
    cy.wait('@getApiKeysWithKey');

    cy.get('[data-testid="api-key-row-key-1"]').scrollIntoView().within(() => {
      cy.contains('Production Server').should('be.visible');
      cy.contains('pe_live_prod1234...').should('be.visible');
      cy.contains('Ativa').should('be.visible');
    });

    cy.on('window:confirm', () => true);
    cy.get('[data-testid="revoke-key-btn-key-1"]').click();
    cy.wait('@revokeApiKey');
  });
});
