// Temporary screenshot spec for PR #651 (delete before finishing).
// Shoots the Story-First Reels detail page after the mixed-media change
// (step 5 now says "licensed stock photos" — no video, the engine renders
// segment media as photos only).
function visitEnglish(path: string) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('social-hub-locale', 'en');
    },
  });
}

describe('mixed-media after shots', () => {
  it('detail-en-desktop', () => {
    cy.viewport(1280, 720);
    visitEnglish('/recipes/story-first-reels');
    cy.contains(
      'It mixes AI photos with real photos and licensed stock photos',
    ).should('be.visible');
    cy.contains(
      'It mixes AI photos with real photos and licensed stock photos',
    ).scrollIntoView();
    cy.screenshot('mixedmedia/detail-en-desktop');
  });

  it('detail-en-mobile', () => {
    cy.viewport(390, 720);
    visitEnglish('/recipes/story-first-reels');
    cy.contains(
      'It mixes AI photos with real photos and licensed stock photos',
    ).should('be.visible');
    cy.contains(
      'It mixes AI photos with real photos and licensed stock photos',
    ).scrollIntoView();
    cy.screenshot('mixedmedia/detail-en-mobile');
  });

  it('detail-pt-desktop', () => {
    cy.viewport(1280, 720);
    cy.visit('/recipes/story-first-reels');
    cy.contains(
      'Ele mistura fotos de IA com fotos reais e fotos de banco de imagem com licença',
    ).should('be.visible');
    cy.contains(
      'Ele mistura fotos de IA com fotos reais e fotos de banco de imagem com licença',
    ).scrollIntoView();
    cy.screenshot('mixedmedia/detail-pt-desktop');
  });
});

export {};
