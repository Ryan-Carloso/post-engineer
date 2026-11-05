describe('API Keys in the prompts hub — UI & E2E', () => {
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

  it('renders the key manager and the setup prompt as steps 1 and 2 of /recipes', () => {
    cy.visit('/recipes');
    // React Query may serve a warm cache — assert UI, not cy.wait on GET.
    cy.location('pathname').should('eq', '/recipes');

    cy.contains('h2', 'Crie sua API key').should('be.visible');
    cy.get('[data-testid="api-keys-empty-state"]')
      .scrollIntoView()
      .should('be.visible')
      .and('contain', 'Nenhuma API key ainda');
    cy.get('[data-testid="generate-api-key-btn"]').scrollIntoView().should('be.visible');

    cy.contains('h2', 'Mande o prompt de setup ao seu agente')
      .scrollIntoView()
      .should('be.visible');
    cy.get('[data-testid="copy-mcp-prompt-btn"]').scrollIntoView().should('be.visible');
    cy.get('[data-testid="mcp-install-prompt"]').should('contain', '<MINHA_API_KEY>');
  });

  it('redirects the old /api-keys page to /recipes', () => {
    cy.visit('/api-keys');
    cy.location('pathname').should('eq', '/recipes');
    cy.get('[data-testid="generate-api-key-btn"]', { timeout: 15_000 }).should('be.visible');
  });

  it('navigates to the key manager from the profile area', () => {
    cy.visit('/account');
    // The desktop sidebar footer renders the same AccountPanel, so scope
    // to the page container (same duplicate-DOM reason as account-profile.cy.ts).
    cy.get('[data-testid=account-page] [data-testid=profile-api-keys-link]')
      .scrollIntoView()
      .click();
    cy.location('pathname').should('eq', '/recipes');
    cy.get('[data-testid="generate-api-key-btn"]', { timeout: 15_000 }).should('be.visible');
  });

  it('generates a new API key, displays it once, and fills it into the setup prompt', () => {
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

    cy.visit('/recipes');
    cy.get('[data-testid="generate-api-key-btn"]', { timeout: 15_000 }).scrollIntoView().click();
    cy.get('[data-testid="create-api-key-form"]').scrollIntoView().should('be.visible');

    cy.get('[data-testid="api-key-name-input"]').type('MCP Automation');
    cy.get('[data-testid="submit-create-key-btn"]').click();

    cy.wait('@createApiKey');

    cy.get('[data-testid="api-key-created-banner"]').scrollIntoView().should('be.visible');
    cy.get('[data-testid="raw-api-key-value"]').should('have.value', 'pe_live_1234567890abcdef1234567890abcdef');
    cy.get('[data-testid="copy-api-key-btn"]').should('be.visible');
    cy.get('[data-testid="mcp-install-prompt"]')
      .should('contain', 'pe_live_1234567890abcdef1234567890abcdef')
      .and('not.contain', '<MINHA_API_KEY>');
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

    cy.visit('/recipes');
    // /recipes is public: a missing session renders the sign-in call to
    // action instead of the key manager, so the keys request never fires
    // and the row lookup below fails — on the missing row, not a timeout.
    cy.location('pathname').should('eq', '/recipes');
    cy.get('[data-testid="api-key-row-key-1"]', { timeout: 15_000 }).scrollIntoView().within(() => {
      cy.contains('Production Server').should('be.visible');
      cy.contains('pe_live_prod1234...').should('be.visible');
      cy.contains('Ativa').should('be.visible');
    });

    cy.on('window:confirm', () => true);
    cy.get('[data-testid="revoke-key-btn-key-1"]').click();
    cy.wait('@revokeApiKey');
  });

  it('copies the MCP install prompt and shows the confirmation label', () => {
    cy.visit('/recipes', {
      onBeforeLoad(win) {
        // The real clipboard API is permission-gated in the runner; the
        // copy handler only needs writeText to resolve.
        cy.stub(win.navigator.clipboard, 'writeText').resolves();
      },
    });
    cy.get('[data-testid="copy-mcp-prompt-btn"]', { timeout: 15_000 })
      .scrollIntoView()
      .should('be.visible')
      .and('contain', 'Copiar')
      .click()
      .should('contain', 'Copiado!');
    cy.get('[data-testid="mcp-install-prompt"]')
      .scrollIntoView()
      .should('contain', 'post-engineer-mcp');
  });
});
