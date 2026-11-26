describe('Docs and help — public crawlable pages', () => {
  it('renders the docs index with links to every guide', () => {
    cy.visit('/docs');
    cy.contains('h1', 'Documentation').should('be.visible');
    cy.get('a[href="/docs/mcp"]').should('be.visible');
    cy.get('a[href="/docs/api"]').should('be.visible');
    cy.get('a[href="/docs/use-cases"]').should('be.visible');
    cy.get('a[href="/docs/integrations"]').should('be.visible');
  });

  it('renders each docs guide with its title and a back link', () => {
    const guides: Array<[string, string]> = [
      ['/docs/mcp', 'MCP server'],
      ['/docs/api', 'HTTP API'],
      ['/docs/use-cases', 'Use cases'],
      ['/docs/integrations', 'Integrations'],
    ];
    for (const [path, title] of guides) {
      cy.visit(path);
      cy.contains('h1', title).should('be.visible');
      cy.get('a[href="/docs"]').should('contain', 'Documentation');
    }
  });

  it('renders the PT help index with links to every article', () => {
    cy.visit('/help');
    cy.contains('h1', 'Ajuda').should('be.visible');
    cy.get('a[href="/help/primeiros-passos"]').should('be.visible');
    cy.get('a[href="/help/conectar-contas"]').should('be.visible');
  });

  it('renders each PT help article with its title and a back link', () => {
    const articles: Array<[string, string]> = [
      ['/help/primeiros-passos', 'Primeiros passos'],
      ['/help/conectar-contas', 'Conectar contas'],
    ];
    for (const [path, title] of articles) {
      cy.visit(path);
      cy.contains('h1', title).should('be.visible');
      cy.get('main a[href="/help"]').should('contain', 'Ajuda');
    }
  });

  it('renders the EN help index and articles', () => {
    cy.visit('/en/help');
    cy.contains('h1', 'Help').should('be.visible');
    cy.get('a[href="/en/help/primeiros-passos"]').should('be.visible');
    cy.get('a[href="/en/help/conectar-contas"]').should('be.visible');
    cy.visit('/en/help/conectar-contas');
    cy.contains('h1', 'Conectar contas').should('be.visible');
    cy.get('a[href="/en/help"]').should('contain', 'Help');
  });

  it('exposes Docs and Help in the footer', () => {
    cy.visit('/docs');
    cy.get('footer').scrollIntoView();
    cy.get('footer a[href="/docs"]').should('be.visible');
    cy.get('footer a[href="/help"]').should('be.visible');
  });
});

export {};
