describe('posts calendar shots', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    cy.intercept('GET', '/api/persona/list', { authenticated: true, personas: [] }).as('personas');
  });

  it('shows one calendar with the day list beside it on desktop and below it on mobile', () => {
    cy.viewport(1440, 900);
    cy.visit('/posts');
    cy.get('[data-calendar-card]', { timeout: 30000 }).should('be.visible');
    cy.get('[data-skeleton-calendar]').should('not.exist');
    cy.get('[data-slot="mini-calendar"]').should('not.exist');
    cy.get('[data-testid="posts-sidebar"]').should('not.exist');
    cy.get('[data-posts-calendar-month]').should('exist');
    cy.get('section[aria-live="polite"]').should('exist');
    cy.screenshot('posts-calendar-desktop', { capture: 'viewport' });
    cy.viewport(390, 844);
    cy.get('[data-calendar-card]').should('be.visible');
    cy.get('[data-posts-calendar-month]').should('exist');
    cy.screenshot('posts-calendar-mobile', { capture: 'viewport' });
  });
});

export {};