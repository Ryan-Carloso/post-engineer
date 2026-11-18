// Temporary screenshot spec for PR #635 (sidebar). Not part of the suite:
// delete after capturing. Logs in via the E2E user, visits /posts, waits
// for the calendar to load, and screenshots the desktop sidebar and the
// unchanged mobile stack. No data is mutated.
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
