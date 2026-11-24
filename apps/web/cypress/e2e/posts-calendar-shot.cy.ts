describe('posts calendar shots', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    cy.intercept('GET', '/api/persona/list', { authenticated: true, personas: [] }).as('personas');
    cy.intercept('GET', '/api/schedule', {
      success: true,
      schedules: [
        {
          id: 'schedule-e2e-1',
          persona_id: 'p1',
          providers: ['youtube'],
          youtube_account_ids: [],
          instagram_account_ids: [],
          linkedin_account_ids: [],
          bluesky_account_ids: [],
          days_of_week: [],
          start_hour: null,
          end_hour: null,
          posts_per_day: 1,
          timezone: 'Europe/Lisbon',
          active: true,
        },
      ],
    }).as('schedules');
    cy.intercept('GET', '/api/schedule/status*', {
      success: true,
      upcoming: [],
      recent: [],
      slots: [],
      hasAnyPost: true,
    }).as('status');
  });

  it('opens the network and persona dropdowns over an opaque panel on desktop', () => {
    cy.intercept('GET', '/api/persona/list', {
      authenticated: true,
      personas: [{ id: 'p1', name: 'Viva Leve', createdAt: '2026-01-01T00:00:00.000Z' }],
    }).as('personasWithOne');
    cy.viewport(1440, 900);
    cy.visit('/posts', { timeout: 120000 });
    cy.get('[data-calendar-card]', { timeout: 60000 }).should('be.visible');
    cy.get('[data-skeleton-calendar]').should('not.exist');

    cy.get('[role="combobox"]').eq(0).should('not.be.disabled');
    cy.get('[role="combobox"]').eq(0).click();
    cy.get('[role="listbox"]', { timeout: 30000 }).should('be.visible');
    cy.get('[role="listbox"]').then(($content) => {
      expect(getComputedStyle($content[0]).backgroundColor, 'network panel background').to.not.eq('rgba(0, 0, 0, 0)');
    });
    cy.get('[role="listbox"] [data-highlighted]')
      .first()
      .then(($item) => {
        expect(getComputedStyle($item[0]).backgroundColor, 'focused network item').to.not.eq('rgb(13, 43, 69)');
      });
    cy.get('body').type('{esc}');
    cy.get('[role="listbox"]').should('not.exist');
    cy.get('body').should('not.have.attr', 'data-scroll-locked');

    cy.get('[role="combobox"]').eq(1).click();
    cy.get('[role="listbox"]', { timeout: 30000 }).should('be.visible');
    cy.get('[role="option"]', { timeout: 30000 }).should('contain', 'Viva Leve');
    cy.get('[role="listbox"]').then(($content) => {
      expect(getComputedStyle($content[0]).backgroundColor, 'persona panel background').to.not.eq('rgba(0, 0, 0, 0)');
    });
    cy.get('body').type('{esc}');
    cy.get('[role="listbox"]').should('not.exist');
    cy.get('body').should('not.have.attr', 'data-scroll-locked');
  });

  it('opens the network and persona dropdowns over an opaque panel on mobile', () => {
    cy.intercept('GET', '/api/persona/list', {
      authenticated: true,
      personas: [{ id: 'p1', name: 'Viva Leve', createdAt: '2026-01-01T00:00:00.000Z' }],
    }).as('personasWithOne');
    cy.viewport(390, 844);
    cy.visit('/posts', { timeout: 120000 });
    cy.get('[data-calendar-card]', { timeout: 60000 }).should('be.visible');
    cy.get('[data-skeleton-calendar]').should('not.exist');

    cy.get('[role="combobox"]').eq(0).should('not.be.disabled');
    cy.get('[role="combobox"]').eq(0).click();
    cy.get('[role="listbox"]', { timeout: 30000 }).should('be.visible');
    cy.get('[role="listbox"]').then(($content) => {
      expect(getComputedStyle($content[0]).backgroundColor, 'network panel background').to.not.eq('rgba(0, 0, 0, 0)');
    });
    cy.get('[role="listbox"] [data-highlighted]')
      .first()
      .then(($item) => {
        expect(getComputedStyle($item[0]).backgroundColor, 'focused network item').to.not.eq('rgb(13, 43, 69)');
      });
    cy.get('body').type('{esc}');
    cy.get('[role="listbox"]').should('not.exist');
    cy.get('body').should('not.have.attr', 'data-scroll-locked');

    cy.get('[role="combobox"]').eq(1).click();
    cy.get('[role="listbox"]', { timeout: 30000 }).should('be.visible');
    cy.get('[role="option"]', { timeout: 30000 }).should('contain', 'Viva Leve');
    cy.get('[role="listbox"]').then(($content) => {
      expect(getComputedStyle($content[0]).backgroundColor, 'persona panel background').to.not.eq('rgba(0, 0, 0, 0)');
    });
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