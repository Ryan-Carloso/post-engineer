//---------------
// Personas list — library face as the card display fallback.
// Covers PersonaCard + PersonaAvatar: library-only, then avatar → photo →
// library after load errors. The list payload is intercepted so CI never
// depends on production personas.
//---------------

describe('Personas list library fallback', () => {
  beforeEach(() => {
    cy.loginE2EUser();
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
            libraryUrl: 'https://example.test/library.png',
          },
        ],
      },
    }).as('getPersonas');

    cy.visit('/personas');
    cy.wait('@getPersonas');
    cy.contains('Library Face').should('be.visible');
    cy.get('img[alt="Library Face"]').should('have.attr', 'src', 'https://example.test/library.png');
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
            avatarUrl: 'https://example.test/avatar.png',
            photoUrl: 'https://example.test/photo.png',
            libraryUrl: 'https://example.test/library.png',
          },
        ],
      },
    }).as('getPersonas');

    cy.visit('/personas');
    cy.wait('@getPersonas');
    cy.get('img[alt="Fallback Chain"]').should('have.attr', 'src', 'https://example.test/avatar.png');
    cy.get('img[alt="Fallback Chain"]').then(($img) => {
      $img[0].dispatchEvent(new Event('error'));
    });
    cy.get('img[alt="Fallback Chain"]').should('have.attr', 'src', 'https://example.test/photo.png');
    cy.get('img[alt="Fallback Chain"]').then(($img) => {
      $img[0].dispatchEvent(new Event('error'));
    });
    cy.get('img[alt="Fallback Chain"]').should('have.attr', 'src', 'https://example.test/library.png');
  });
});
