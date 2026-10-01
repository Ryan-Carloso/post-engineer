//---------------
// Posts video detail E2E — reproduces the user-reported failure: a post
// whose video exists in the engine but whose player stayed black because
// the guessed file name (final-1.mp4) 404'd. The detail page must load
// the video successfully through the download proxy's fallback redirect.
//---------------

describe('Posts video detail', () => {
  before(() => {
    cy.loginE2EUser();
  });

  it('opens a history post detail and loads its video without 404s', () => {
    cy.intercept('GET', '/api/persona/video-download/**').as('videoDownload');
    cy.intercept('GET', '/api/schedule/slots/**').as('slotDetail');

    cy.visit('/posts');

    // History tab holds published posts and manual generations.
    cy.contains('button', /Histórico|History/).click();

    // Open the first available post card (slot or generation).
    cy.get('a[href^="/posts/"]').first().click();
    cy.url().should('match', /\/posts\/[^/]+$/);

    // The detail page must resolve its entity by id.
    cy.wait(['@slotDetail', '@videoDownload'], { timeout: 30_000 }).then((interceptions) => {
      for (const interception of interceptions.flat()) {
        expect(interception.response?.statusCode, 'download/status must not 404').to.not.eq(404);
      }
    });

    // The video metadata must actually load: the debug line switches from
    // "loading…" to the resolved dimensions once loadedmetadata fires.
    cy.get('[data-testid="video-debug"]', { timeout: 30_000 })
      .invoke('text')
      .should('match', /\d+×\d+/);
  });
});
