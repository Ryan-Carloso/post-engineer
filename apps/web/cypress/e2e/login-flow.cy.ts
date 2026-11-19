describe('Login (UI)', () => {
  it('renderiza título, subtítulo e botão de login GitHub', () => {
    cy.visit('/login');
    cy.contains('h2', 'Bem-vindo de volta').should('be.visible');
    cy.contains('p', 'Conecte suas contas e continue a criar').should('be.visible');
    cy.contains('button', 'Continuar com GitHub').should('be.visible');
  });

  it('aplicação de login é responsiva (layout centrado)', () => {
    cy.viewport(375, 667);
    cy.visit('/login');
    cy.contains('button', 'Continuar com GitHub').should('be.visible');
  });
});