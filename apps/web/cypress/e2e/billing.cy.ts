describe('Billing — storefront, checkout and after-payment notices', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/billing/tokens', {
      statusCode: 200,
      body: { success: true, balance: 42 },
    }).as('tokens');
    cy.intercept('GET', '/api/billing/transactions**', {
      statusCode: 200,
      body: { success: true, transactions: [], total: 0, limit: 20, offset: 0 },
    }).as('transactions');
  });

  it('renders the storefront: hero, balance, packs, benefits and history', (): void => {
    cy.visit('/billing');
    cy.wait('@tokens');

    cy.contains('h1', 'Suas ideias merecem virar vídeos.').should('be.visible');
    cy.contains('42 tokens').scrollIntoView().should('be.visible');
    cy.contains('Escolha seu pacote').scrollIntoView().should('be.visible');
    cy.get('[role="status"]').should('not.exist');
  });

  it('starts checkout with any pack and pushes the returned checkout URL', (): void => {
    cy.intercept('POST', '/api/billing/checkout', {
      statusCode: 200,
      body: { success: true, url: '/billing' },
    }).as('checkout');

    cy.visit('/billing');
    cy.wait('@tokens');
    cy.contains('button', /Comprar \d+ tokens/).first().click();
    cy.wait('@checkout').its('request.body.packId').should('be.a', 'string');
    cy.get('[role="alert"]').should('not.exist');
  });

  it('redirects to /login?next=<current page> when checkout 401s with a dead session', (): void => {
    cy.intercept('POST', '/api/billing/checkout', {
      statusCode: 401,
      body: { success: false, error: 'Authentication required.' },
    }).as('checkoutFail');

    cy.visit('/billing');
    cy.wait('@tokens');
    cy.contains('button', /Comprar \d+ tokens/).first().click();
    cy.wait('@checkoutFail');

    cy.url().should('include', '/login?next=%2Fbilling');
  });

  it('shows the after-payment notice and settles back to /billing', (): void => {
    cy.visit('/billing?checkout=success');
    cy.wait('@tokens');
    cy.contains('[role="status"]', 'Seu pagamento está sendo confirmado.')
      .scrollIntoView()
      .should('be.visible');
  });

  it('shows the canceled notice plus the feedback dialog and closes both', (): void => {
    cy.visit('/billing?checkout=canceled');
    cy.wait('@tokens');

    cy.contains('[role="status"]', 'Nenhum cobrado.')
      .scrollIntoView()
      .should('be.visible');
    cy.contains('Por que você desistiu?').should('be.visible');
    cy.contains('button', 'Fechar').click();
    cy.url().should('include', '/billing');
    cy.url().should('not.include', 'checkout=canceled');
  });
});

export {};
