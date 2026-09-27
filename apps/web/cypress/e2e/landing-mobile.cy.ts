//---------------
// Landing Mobile — testes responsivos da landing em viewport mobile.
// Garante que o header caiba em 390px sem scroll horizontal e que a
// navegação mobile (hambúrguer) exponha Entrar, idioma e âncoras.
//---------------

describe('Landing — Mobile (390px)', () => {
  beforeEach(() => {
    cy.viewport(390, 844);
    cy.visit('/landing');
    cy.get('header').should('be.visible');
  });

  it('não tem scroll horizontal em 390px', () => {
    cy.window().then((win) => {
      const doc = win.document.documentElement;
      expect(doc.scrollWidth, 'largura total com scroll').to.be.lte(390);
    });
  });

  it('header mobile mostra logo, CTA e botão do menu; esconde navegação desktop', () => {
    cy.get('header a[href="/landing"]').should('be.visible');
    cy.get('[data-testid="landing-mobile-menu-button"]').should('be.visible');
    cy.get('[data-testid="landing-desktop-nav"]').should('not.be.visible');
    cy.get('[data-testid="landing-desktop-actions"]').should('not.be.visible');
  });

  it('menu mobile abre e expõe Entrar, seletor de idioma e links de âncora', () => {
    cy.get('[data-testid="landing-mobile-menu"]').should('not.exist');
    cy.get('[data-testid="landing-mobile-menu-button"]').click();
    cy.get('[data-testid="landing-mobile-menu"]').should('be.visible');
    cy.get('[data-testid="landing-mobile-menu"] a[href="/login"]').should(
      'have.length.greaterThan',
      0,
    );
    cy.get('[data-testid="landing-mobile-menu"]').contains('button', 'PT').should('be.visible');
    cy.get('[data-testid="landing-mobile-menu"]').contains('button', 'EN').should('be.visible');
    cy.get('[data-testid="landing-mobile-menu"] a[href="#pricing"]').should('be.visible');
  });

  it('menu mobile fecha ao clicar de novo no botão', () => {
    cy.get('[data-testid="landing-mobile-menu-button"]').click();
    cy.get('[data-testid="landing-mobile-menu"]').should('be.visible');
    cy.get('[data-testid="landing-mobile-menu-button"]').click();
    cy.get('[data-testid="landing-mobile-menu"]').should('not.exist');
  });

  it('hero e CTA principal continuam visíveis em 390px', () => {
    cy.contains('h1', 'Seu canal do YouTube e Instagram, sempre ativo.').should('be.visible');
    cy.get('main a[href="/login"]').first().should('be.visible').and('contain', 'Começar agora');
  });

  it('desktop mantém navegação completa e esconde o botão mobile', () => {
    cy.viewport(1280, 800);
    cy.visit('/landing');
    cy.get('[data-testid="landing-desktop-nav"]').should('be.visible');
    cy.get('[data-testid="landing-desktop-actions"]').should('be.visible');
    cy.get('[data-testid="landing-mobile-menu-button"]').should('not.be.visible');
  });
});
