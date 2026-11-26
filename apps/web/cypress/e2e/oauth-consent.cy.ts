describe('OAuth consent — no valid request', () => {
  it('redirects to the landing page without a consent request token', () => {
    cy.clearCookies();
    cy.visit('/oauth/consent');
    cy.url().should('include', '/landing');
    cy.get('header').should('be.visible');
  });
});

export {};
