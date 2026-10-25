//---------------
// Personas list — library face as the card display fallback.
// Covers PersonaCard + PersonaAvatar: library-only, then avatar → photo →
// library after load errors. The list payload is intercepted so CI never
// depends on production personas.
//
// Same-origin URLs: next/image rejects unconfigured remote hosts
// (see account-profile.cy.ts). Broken avatar/photo are intercepted 404s so
// the real onError path runs; the library URL is a public PNG that loads.
//---------------

describe('Personas list library fallback', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    cy.intercept('GET', '/e2e-broken-avatar.png', { statusCode: 404, body: '' });
    cy.intercept('GET', '/e2e-broken-photo.png', { statusCode: 404, body: '' });
  });

  it('shows the library image when the persona has no avatar or photo', () => {
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: {
        authenticated: true,
        personas: [
          {
            id: 'p-lib',
            name: 'Library Face',
            createdAt: '2026-08-29T00:00:00Z',
            libraryUrl: '/icon-128.png',
          },
        ],
      },
    }).as('getPersonas');

    cy.visit('/personas');
    cy.wait('@getPersonas');
    cy.contains('Library Face').should('be.visible');
    cy.get('img[alt="Library Face"]').should('have.attr', 'src', '/icon-128.png');
  });

  it('falls through avatar then photo then library on the persona card', () => {
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: {
        authenticated: true,
        personas: [
          {
            id: 'p-chain',
            name: 'Fallback Chain',
            createdAt: '2026-08-29T00:00:00Z',
            avatarUrl: '/e2e-broken-avatar.png',
            photoUrl: '/e2e-broken-photo.png',
            libraryUrl: '/icon-128.png',
          },
        ],
      },
    }).as('getPersonas');

    cy.visit('/personas');
    cy.wait('@getPersonas');
    cy.contains('Fallback Chain').should('be.visible');
    cy.get('img[alt="Fallback Chain"]', { timeout: 10000 }).should(
      'have.attr',
      'src',
      '/icon-128.png',
    );
  });
});
