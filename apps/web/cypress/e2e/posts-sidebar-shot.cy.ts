describe('posts sidebar shots', () => {
  it('captures the sidebar on desktop and the unchanged mobile stack', () => {
    cy.loginE2EUser();
    cy.viewport(1440, 900);
    cy.visit('/posts');
    cy.get('[data-calendar-card]', { timeout: 30000 }).should('be.visible');
    cy.get('[data-skeleton-calendar]').should('not.exist');
    cy.get('[data-testid="posts-sidebar"]').should('be.visible');
    cy.screenshot('posts-sidebar-desktop', { capture: 'viewport' });
    cy.viewport(390, 844);
    cy.get('[data-calendar-card]').should('be.visible');
    cy.get('[data-testid="posts-sidebar"]').should('not.be.visible');
    cy.screenshot('posts-sidebar-mobile', { capture: 'viewport' });
  });
});

export {};
